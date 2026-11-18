-- Lessons get a length, end by themselves, and finished lessons give
-- points. Run once, after 2026-11-21-admin-schools.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * Every lesson has a length: 15 minutes to 4 hours in 15-minute steps,
--   1 hour unless chosen otherwise, for "now" invitations and proposed
--   times alike.
-- * The lesson's time starts at the agreed time, or for a "now" lesson once
--   both students are in the call. When the time is over, the page says so
--   and warns that the call ends in 5 minutes; 5 minutes after the end the
--   database ends the call itself.
-- * A lesson is finished when both students were in it and both stayed
--   until at least 5 minutes before its end (ending it up to 5 minutes early
--   still counts). A finished lesson gives points: the teacher 10 and the
--   student 5 per hour of lesson (see lesson_points to change this).
-- * Points are kept in public.points (one row per student per lesson), so a
--   leaderboard can be built from it later. my_points() gives a student
--   their own total.
-- * Also (mokyklos.html, admins only): everything about one school, and
--   deleting its unused registration codes, one, several or all at once.
--   Codes a student has used, or is signing up with right now, stay.

-- ---------------------------------------------------------------------------
-- Columns and the points table
-- ---------------------------------------------------------------------------

alter table public.lessons
  add column duration_minutes smallint not null default 60
    check (duration_minutes between 15 and 240 and duration_minutes % 15 = 0),
  -- When the lesson's time started: the agreed time, or for a "now" lesson
  -- the moment both students were in the call.
  add column began_at timestamptz,
  -- Set once the lesson has been judged finished or not (points given).
  add column judged_at timestamptz,
  add column finished boolean;

create table public.points (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  lesson_id   uuid references public.lessons (id) on delete set null,
  reason      text not null check (reason in ('lesson_teacher', 'lesson_student')),
  amount      int not null check (amount > 0),
  created_at  timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create index points_user on public.points (user_id);

alter table public.points enable row level security;
revoke all on public.points from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not callable through the website's key)
-- ---------------------------------------------------------------------------

-- "1 val.", "1 val. 30 min.", "45 min.", for chat messages.
create function public.lesson_duration_text(p_minutes int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_minutes < 60 then p_minutes || ' min.'
    when p_minutes % 60 = 0 then (p_minutes / 60) || ' val.'
    else (p_minutes / 60) || ' val. ' || (p_minutes % 60) || ' min.'
  end;
$$;

-- Points for a finished lesson of p_minutes: 10 an hour for the teacher,
-- 5 an hour for the student, rounded, at least 1.
create function public.lesson_points(p_minutes int, p_teacher boolean)
returns int
language sql
immutable
set search_path = ''
as $$
  select greatest(1, round(p_minutes * (case when p_teacher then 10 else 5 end) / 60.0))::int;
$$;

-- When the lesson's time ends; empty for a "now" lesson nobody has started.
create function public.lesson_ends_at(l public.lessons)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(l.began_at, l.starts_at) + make_interval(mins => l.duration_minutes);
$$;

-- Judges an over lesson once: finished or not, and gives the points.
create function public.lesson_judge(p_lesson uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l         public.lessons;
  r         public.meeting_rooms;
  v_end     timestamptz;
  v_stayed  timestamptz;
  v_both    boolean;
begin
  select * into l from public.lessons x where x.id = p_lesson;
  if l.id is null or l.judged_at is not null or l.status <> 'accepted' then
    return;
  end if;
  select * into r from public.meeting_rooms m where m.id = l.room_id;
  v_end := public.lesson_ends_at(l);
  -- Not over yet: the call is still on, or (never opened) its time isn't up.
  if r.id is not null and r.ended_at is null and now() < coalesce(v_end, r.expires_at) + interval '5 minutes' then
    return;
  end if;
  if r.id is null and (v_end is null or now() < v_end + interval '5 minutes') then
    return;
  end if;

  select * into l from public.lessons x where x.id = p_lesson for update;
  if l.judged_at is not null then
    return;
  end if;

  -- Both were in the call, and how long the one who left first stayed.
  select count(*) = 2, min(least(p.last_seen_at, coalesce(r.ended_at, p.last_seen_at)))
    into v_both, v_stayed
    from public.meeting_participants p
   where p.room_id = l.room_id and p.user_id in (l.teacher_id, l.student_id)
     and p.first_admitted_at is not null;

  update public.lessons x
     set judged_at = now(),
         -- Up to 5 minutes early counts (and half a minute for the page's
         -- last "still here" to reach the database).
         finished = not l.ended_late and coalesce(v_both, false) and v_end is not null
                    and v_stayed >= v_end - interval '5 minutes 30 seconds'
   where x.id = l.id
   returning * into l;

  if l.finished then
    insert into public.points (user_id, lesson_id, reason, amount)
    values (l.teacher_id, l.id, 'lesson_teacher', public.lesson_points(l.duration_minutes, true)),
           (l.student_id, l.id, 'lesson_student', public.lesson_points(l.duration_minutes, false))
    on conflict (user_id, lesson_id) do nothing;
  end if;
end;
$$;

-- Keeps a lesson's call on time: starts the clock of a "now" lesson once
-- both are in, makes the call end 5 minutes after the lesson's end, and
-- judges the lesson once it is over.
create function public.lesson_tick(p_lesson uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l       public.lessons;
  v_both  timestamptz;
  v_end   timestamptz;
begin
  select * into l from public.lessons x where x.id = p_lesson;
  if l.id is null or l.status <> 'accepted' then
    return;
  end if;
  if l.began_at is null and l.room_id is not null then
    if l.starts_at is not null then
      update public.lessons x set began_at = l.starts_at where x.id = l.id and x.began_at is null;
    else
      select max(p.first_admitted_at) into v_both
        from public.meeting_participants p
       where p.room_id = l.room_id and p.user_id in (l.teacher_id, l.student_id)
         and p.first_admitted_at is not null
      having count(*) = 2;
      if v_both is not null then
        update public.lessons x set began_at = v_both where x.id = l.id and x.began_at is null;
      end if;
    end if;
    select * into l from public.lessons x where x.id = p_lesson;
  end if;

  v_end := public.lesson_ends_at(l);
  if v_end is not null and l.room_id is not null then
    update public.meeting_rooms m
       set expires_at = v_end + interval '5 minutes'
     where m.id = l.room_id and m.ended_at is null
       and m.expires_at is distinct from v_end + interval '5 minutes';
  end if;
  perform public.lesson_judge(l.id);
end;
$$;

revoke all on function public.lesson_duration_text(int)        from public, anon, authenticated;
revoke all on function public.lesson_points(int, boolean)      from public, anon, authenticated;
revoke all on function public.lesson_ends_at(public.lessons)   from public, anon, authenticated;
revoke all on function public.lesson_judge(uuid)               from public, anon, authenticated;
revoke all on function public.lesson_tick(uuid)                from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The call of a lesson, on time
-- ---------------------------------------------------------------------------

-- Same as before, and: a lesson at an agreed time gets a call that ends 5
-- minutes after the lesson does.
create or replace function public.lesson_make_room(p_lesson uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  l       public.lessons;
  v_code  text;
  v_room  uuid;
begin
  select * into l from public.lessons x where x.id = p_lesson for update;
  if l.room_id is not null then
    return (select m.code from public.meeting_rooms m where m.id = l.room_id);
  end if;
  loop
    v_code := public.new_meeting_code();
    insert into public.meeting_rooms (code, owner_id, guest_id, kind, expires_at)
    values (v_code, l.teacher_id, l.student_id, 'lesson',
            case when l.starts_at is null then now() + interval '3 hours'
                 else l.starts_at + make_interval(mins => l.duration_minutes) + interval '5 minutes' end)
    on conflict do nothing
    returning id into v_room;
    exit when v_room is not null;
  end loop;
  update public.lessons x set room_id = v_room where x.id = p_lesson;
  return v_code;
end;
$$;

-- Same as before, and: the lesson is kept on time first.
create or replace function public.meeting_find(p_code text)
returns public.meeting_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.meeting_rooms;
begin
  select * into r from public.meeting_rooms m where m.code = public.normalize_meeting_code(p_code);
  if r.id is not null and r.kind = 'lesson' and r.ended_at is null then
    perform public.lesson_settle((select l.id from public.lessons l where l.room_id = r.id));
    perform public.lesson_tick((select l.id from public.lessons l where l.room_id = r.id));
    select * into r from public.meeting_rooms m where m.id = r.id;
  end if;
  if r.id is not null and r.ended_at is null and r.expires_at <= now() then
    update public.meeting_rooms m set ended_at = m.expires_at
     where m.id = r.id and m.ended_at is null;
    r.ended_at := r.expires_at;
    if r.kind = 'lesson' then
      perform public.lesson_judge((select l.id from public.lessons l where l.room_id = r.id));
    end if;
  end if;
  return r;
end;
$$;

-- Same as before, with the lesson's own length instead of 3 hours.
create or replace function public.lesson_pending(p_a uuid, p_b uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
    from public.lessons l
    left join public.meeting_rooms m on m.id = l.room_id
   where l.teacher_id in (p_a, p_b) and l.student_id in (p_a, p_b)
     and l.starts_at is not null
     and not l.ended_late
     and (
       (l.status = 'proposed' and l.starts_at > now())
       or (l.status = 'accepted'
           and case when m.id is null then now() < public.lesson_ends_at(l) + interval '5 minutes'
                    else m.ended_at is null and m.expires_at > now() end)
     )
   order by l.starts_at
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- What the chat and the lesson page call
-- ---------------------------------------------------------------------------

-- Same as before, with the lesson's length (p_duration minutes, 15-240 in
-- 15-minute steps; 60 if not given).
drop function public.lesson_request(uuid, timestamptz);

create function public.lesson_request(p_partner uuid, p_starts_at timestamptz default null, p_duration int default 60)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_gate     text := public.meeting_gate();
  v_teacher  uuid;
  v_student  uuid;
  v_id       uuid;
  v_length   int := coalesce(p_duration, 60);
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  if p_partner is null or not public.can_message(p_partner) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  if exists (select 1 from public.teacher_profiles t where t.id = v_me) then
    v_teacher := v_me;
    v_student := p_partner;
  elsif exists (select 1 from public.teacher_profiles t where t.id = p_partner) then
    v_teacher := p_partner;
    v_student := v_me;
  else
    return jsonb_build_object('ok', false, 'error', 'no_teacher');
  end if;

  if v_length not between 15 and 240 or v_length % 15 <> 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_duration');
  end if;
  if p_starts_at is not null
     and (p_starts_at < now() + interval '5 minutes' or p_starts_at > now() + interval '1 year') then
    return jsonb_build_object('ok', false, 'error', 'bad_time');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(v_me, p_partner)::text || greatest(v_me, p_partner)::text, 0));

  if p_starts_at is null then
    select l.id into v_id
      from public.lessons l
      join public.meeting_rooms m on m.id = l.room_id
     where l.teacher_id in (v_me, p_partner) and l.student_id in (v_me, p_partner)
       and l.starts_at is null and l.status = 'accepted'
       and m.ended_at is null and m.expires_at > now()
     order by l.created_at desc
     limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'id', v_id, 'again', true);
    end if;
  elsif public.lesson_pending(v_me, p_partner) is not null then
    return jsonb_build_object('ok', false, 'error', 'already', 'id', public.lesson_pending(v_me, p_partner));
  end if;

  if not public.meeting_allow(v_me, 'lesson', interval '1 hour', 20) then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  perform public.meeting_cleanup_if_due();

  insert into public.lessons (teacher_id, student_id, proposed_by, starts_at, status, decided_at, duration_minutes)
  values (v_teacher, v_student, v_me, p_starts_at,
          case when p_starts_at is null then 'accepted' else 'proposed' end,
          case when p_starts_at is null then now() end,
          v_length)
  returning id into v_id;
  if p_starts_at is null then
    perform public.lesson_make_room(v_id);
  end if;

  insert into public.messages (sender_id, recipient_id, body, lesson_id, lesson_event)
  values (v_me, p_partner,
          case when p_starts_at is null then 'Kviečiu į pamoką dabar (' || public.lesson_duration_text(v_length) || ').'
               else 'Siūlau pamoką: ' || public.lesson_time_text(p_starts_at) || ', ' || public.lesson_duration_text(v_length) end,
          v_id,
          case when p_starts_at is null then 'invite' else 'propose' end);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.lesson_request(uuid, timestamptz, int) from public, anon, authenticated;
grant execute on function public.lesson_request(uuid, timestamptz, int) to authenticated;

-- Same as before, and: the lesson's length and when it ends; for a lesson
-- that is over, the points the caller got for it.
create or replace function public.lesson_open(p_lesson uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_gate     text := public.meeting_gate();
  l          public.lessons;
  r          public.meeting_rooms;
  v_code     text;
  v_other    uuid;
  v_partner  jsonb;
  v_points   int;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  select * into l from public.lessons x
   where x.id = p_lesson and v_me in (x.teacher_id, x.student_id);
  if l.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform public.lesson_settle(l.id);
  perform public.lesson_tick(l.id);
  select * into l from public.lessons x where x.id = p_lesson for update;

  v_other := case when l.teacher_id = v_me then l.student_id else l.teacher_id end;
  select jsonb_build_object('id', o.id, 'name', o.full_name, 'username', o.username, 'avatar', o.avatar)
    into v_partner from public.profiles o where o.id = v_other;
  select p.amount into v_points from public.points p where p.lesson_id = l.id and p.user_id = v_me;

  if l.ended_late then
    return jsonb_build_object('ok', false, 'error', 'late', 'partner', v_partner, 'starts_at', l.starts_at,
      'late', case when l.late_user is null then 'both' when l.late_user = v_me then 'me' else 'them' end);
  end if;
  if l.status <> 'accepted' then
    return jsonb_build_object('ok', false, 'error', case when l.status = 'cancelled' then 'cancelled' else 'not_agreed' end);
  end if;
  if public.is_blocked_between(l.teacher_id, l.student_id) then
    return jsonb_build_object('ok', false, 'error', 'refused');
  end if;

  if l.room_id is null then
    if now() < l.starts_at - interval '10 minutes' then
      return jsonb_build_object('ok', false, 'error', 'early', 'starts_at', l.starts_at);
    end if;
    if now() > public.lesson_ends_at(l) + interval '5 minutes' then
      return jsonb_build_object('ok', false, 'error', 'over', 'finished', coalesce(l.finished, false), 'points', v_points);
    end if;
    v_code := public.lesson_make_room(l.id);
  else
    select m.code into v_code from public.meeting_rooms m where m.id = l.room_id;
  end if;

  r := public.meeting_find(v_code);
  if r.id is null or r.ended_at is not null then
    select * into l from public.lessons x where x.id = p_lesson;
    select p.amount into v_points from public.points p where p.lesson_id = l.id and p.user_id = v_me;
    return jsonb_build_object('ok', false, 'error', 'over', 'finished', coalesce(l.finished, false), 'points', v_points);
  end if;
  select * into l from public.lessons x where x.id = p_lesson;

  return jsonb_build_object(
    'ok', true,
    'code', r.code,
    'starts_at', l.starts_at,
    'duration', l.duration_minutes,
    'ends_at', public.lesson_ends_at(l),
    'i_teach', l.teacher_id = v_me,
    'partner', v_partner,
    'now', now(),
    'partner_joined', exists (
      select 1 from public.meeting_participants p
       where p.room_id = r.id and p.user_id = v_other and p.first_admitted_at is not null
    )
  );
end;
$$;

-- For the lesson page during the call: when the lesson ends (empty until a
-- "now" lesson has both students in it), and the database's clock.
create function public.lesson_timing(p_lesson uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  l     public.lessons;
begin
  select * into l from public.lessons x
   where x.id = p_lesson and v_me in (x.teacher_id, x.student_id);
  if l.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform public.lesson_tick(l.id);
  select * into l from public.lessons x where x.id = p_lesson;
  return jsonb_build_object('ok', true, 'ends_at', public.lesson_ends_at(l), 'now', now());
end;
$$;

revoke all on function public.lesson_timing(uuid) from public, anon, authenticated;
grant execute on function public.lesson_timing(uuid) to authenticated;

-- Same as before, and each lesson's length, and the points the caller got.
create or replace function public.lesson_list(p_partner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'signed_out');
  end if;
  perform public.lesson_settle(l.id)
     from public.lessons l
    where l.teacher_id in (v_me, p_partner) and l.student_id in (v_me, p_partner)
      and l.status = 'accepted' and not l.ended_late
      and l.starts_at between now() - interval '1 day' and now() - interval '15 minutes';
  perform public.lesson_tick(l.id)
     from public.lessons l
    where l.teacher_id in (v_me, p_partner) and l.student_id in (v_me, p_partner)
      and l.status = 'accepted' and l.judged_at is null
      and coalesce(l.starts_at, l.created_at) > now() - interval '7 days';

  return jsonb_build_object(
    'ok', true,
    'can_request', public.meeting_gate() is null and public.can_message(p_partner) and exists (
      select 1 from public.teacher_profiles t where t.id in (v_me, p_partner)
    ),
    'pending', public.lesson_pending(v_me, p_partner),
    'lessons', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'starts_at', q.starts_at, 'by_me', q.proposed_by = v_me,
               'i_teach', q.teacher_id = v_me, 'state', q.state,
               'duration', q.duration_minutes,
               'points', q.my_points,
               'cancel', case when q.cancel_requested_by = v_me then 'me'
                              when q.cancel_requested_by is not null then 'them' end,
               'reschedule', case when q.reschedule_by = v_me then 'me'
                                  when q.reschedule_by is not null then 'them' end,
               'reschedule_to', q.reschedule_to,
               'late', case when not q.ended_late then null
                            when q.late_user is null then 'both'
                            when q.late_user = v_me then 'me' else 'them' end
             ) order by q.created_at desc), '[]'::jsonb)
        from (
          select l.id, l.starts_at, l.proposed_by, l.teacher_id, l.created_at, l.cancel_requested_by,
                 l.reschedule_by, l.reschedule_to, l.ended_late, l.late_user, l.duration_minutes,
                 (select p.amount from public.points p where p.lesson_id = l.id and p.user_id = v_me) as my_points,
                 case
                   when l.ended_late then 'late'
                   when l.status = 'proposed' and l.starts_at <= now() then 'expired'
                   when l.status <> 'accepted' then l.status
                   when m.id is not null and (m.ended_at is not null or m.expires_at <= now()) then 'over'
                   when m.id is null and l.starts_at is null and now() > l.created_at + interval '3 hours' then 'over'
                   when m.id is null and now() > public.lesson_ends_at(l) + interval '5 minutes' then 'over'
                   when l.starts_at is null or now() >= l.starts_at - interval '10 minutes' then 'open'
                   else 'upcoming'
                 end as state
            from public.lessons l
            left join public.meeting_rooms m on m.id = l.room_id
           where l.teacher_id in (v_me, p_partner) and l.student_id in (v_me, p_partner)
             and p_partner <> v_me
           order by l.created_at desc
           limit 100
        ) q
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Points
-- ---------------------------------------------------------------------------

-- The signed-in student's points: { ok, total, lessons }. Lessons of the
-- last week that ended are judged first, so points never wait for a page.
create function public.my_points()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'signed_out');
  end if;
  perform public.lesson_tick(l.id)
     from public.lessons l
    where v_me in (l.teacher_id, l.student_id)
      and l.status = 'accepted' and l.judged_at is null
      and coalesce(l.starts_at, l.created_at) > now() - interval '7 days';
  return jsonb_build_object(
    'ok', true,
    'total', (select coalesce(sum(p.amount), 0) from public.points p where p.user_id = v_me),
    'lessons', (select count(*) from public.points p where p.user_id = v_me and p.lesson_id is not null)
  );
end;
$$;

revoke all on function public.my_points() from public, anon, authenticated;
grant execute on function public.my_points() to authenticated;

-- ---------------------------------------------------------------------------
-- One school in detail, and its registration codes (admins)
-- ---------------------------------------------------------------------------

alter table public.admin_log drop constraint if exists admin_log_action_check;
alter table public.admin_log add constraint admin_log_action_check check (
  action in ('update_user', 'delete_user', 'update_school', 'extend_school', 'delete_school', 'delete_codes')
);

-- A code's state: free (nobody has it), pending (someone is signing up with
-- it and hasn't confirmed their email yet), used.
create function public.access_code_state(p_redeemed_by uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_redeemed_by is null then 'free'
    when exists (select 1 from auth.users u where u.id = p_redeemed_by and u.email_confirmed_at is not null) then 'used'
    else 'pending'
  end;
$$;

revoke all on function public.access_code_state(uuid) from public, anon, authenticated;

-- Everything about one school: its details and counts, its students, who
-- made which codes when, and every code (at most 5000, newest first).
create function public.admin_school(p_school uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s  public.schools;
begin
  if auth.uid() is null or not exists (select 1 from public.admins where user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into v_s from public.schools where id = p_school;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'today', public.today_lt(),
    'school', jsonb_build_object(
      'id', v_s.id, 'name', v_s.name, 'contact_email', v_s.contact_email,
      'subscription_ends', v_s.subscription_ends, 'created_at', v_s.created_at),
    'counts', (
      select jsonb_build_object(
               'codes', count(*),
               'free', count(*) filter (where c.state = 'free'),
               'pending', count(*) filter (where c.state = 'pending'),
               'used', count(*) filter (where c.state = 'used'))
        from (select public.access_code_state(a.redeemed_by) as state
                from public.access_codes a where a.school_id = v_s.id) c
    ),
    'students', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'full_name', p.full_name, 'username', p.username, 'grade', p.grade,
               'teacher', exists (select 1 from public.teacher_profiles t where t.id = p.id),
               'created_at', p.created_at
             ) order by p.full_name), '[]'::jsonb)
        from public.profiles p where p.school_id = v_s.id
    ),
    'batches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'created_at', b.created_at, 'count', b.code_count, 'by', p.username
             ) order by b.created_at desc), '[]'::jsonb)
        from public.access_code_batches b
        left join public.profiles p on p.id = b.created_by
       where b.school_id = v_s.id
    ),
    'codes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'code', 'MOK-' || substr(q.code, 1, 4) || '-' || substr(q.code, 5, 4),
               'state', q.state, 'created_at', q.created_at, 'redeemed_at', q.redeemed_at,
               'username', q.username
             ) order by q.created_at desc, q.code), '[]'::jsonb)
        from (
          select a.code, a.created_at, a.redeemed_at, p.username,
                 public.access_code_state(a.redeemed_by) as state
            from public.access_codes a
            left join public.profiles p on p.id = a.redeemed_by
           where a.school_id = v_s.id
           order by a.created_at desc, a.code
           limit 5000
        ) q
    )
  );
end;
$$;

revoke all on function public.admin_school(uuid) from public, anon, authenticated;
grant execute on function public.admin_school(uuid) to authenticated;

-- Deletes the school's free codes given in p_codes (as students type them),
-- or all its free codes when p_codes is empty. Used and pending codes are
-- never deleted. { ok, deleted }
create function public.admin_delete_codes(p_school uuid, p_codes text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_name     text;
  v_deleted  int;
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select name into v_name from public.schools where id = p_school;
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_codes is not null and cardinality(p_codes) > 5000 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;

  delete from public.access_codes a
   where a.school_id = p_school
     and a.redeemed_by is null
     and (p_codes is null
          or a.code = any (select public.normalize_access_code(c) from unnest(p_codes) c));
  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    insert into public.admin_log (admin_id, action, target_id, target_username, details)
    values (v_me, 'delete_codes', p_school, v_name,
            jsonb_build_object('deleted', v_deleted, 'all_free', p_codes is null));
  end if;
  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

revoke all on function public.admin_delete_codes(uuid, text[]) from public, anon, authenticated;
grant execute on function public.admin_delete_codes(uuid, text[]) to authenticated;
