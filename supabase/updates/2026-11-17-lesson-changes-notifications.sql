-- Lessons: calling off without asking, moving to another time by agreement,
-- what happens when someone is late; and the notifications shown on the
-- website. Run once, after 2026-11-16-delete-messages-cancel-lessons.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * Either student can call off an agreed lesson before it starts, without
--   asking; the other gets a message.
-- * Moving a lesson to another time needs both: one proposes, the other
--   agrees or refuses. Until then the old time stands.
-- * Being late, for an agreed lesson at time T:
--     from T+10 min the student who came may call it off,
--     at T+15 min, if one came and the other didn't, it ends 60 seconds
--       later (at T+16), unless the other arrives meanwhile,
--     at T+15 min, if neither came, it ends.
--   A lesson ended like this is marked "ended late", with who was late.
-- * my_notifications() gives the website what to show in the corner:
--   new messages, and lesson moments (can join now, the other joined, you
--   are 5 / 10 minutes late, the lesson ended because of being late).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.lessons
  add column ended_late     boolean not null default false,
  -- Who was late; empty when both were.
  add column late_user      uuid references public.profiles (id) on delete set null,
  add column ended_late_at  timestamptz,
  -- A proposed new time, and who proposed it.
  add column reschedule_to  timestamptz,
  add column reschedule_by  uuid references public.profiles (id) on delete set null;

-- The new time a "move the lesson" card proposes.
alter table public.messages add column lesson_at timestamptz;

alter table public.messages drop constraint messages_lesson_event_check;
alter table public.messages add constraint messages_lesson_event_check
  check (lesson_event in ('invite', 'propose', 'cancel', 'reschedule'));

-- Calling off no longer needs the other's agreement: requests left open by
-- the previous version are dropped.
update public.lessons
   set cancel_requested_by = null, cancel_requested_at = null
 where cancel_requested_by is not null;

-- ---------------------------------------------------------------------------
-- Being late
-- ---------------------------------------------------------------------------

-- Ends an agreed lesson whose people were too late, if it is time to.
create function public.lesson_settle(p_lesson uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l         public.lessons;
  v_joined  uuid[];
  v_n       int;
  v_late    uuid;
begin
  -- A quick look first: nearly always there is nothing to do.
  select * into l from public.lessons x where x.id = p_lesson;
  if l.id is null or l.status <> 'accepted' or l.starts_at is null or l.ended_late
     or now() < l.starts_at + interval '15 minutes' then
    return;
  end if;
  select * into l from public.lessons x where x.id = p_lesson for update;
  if l.ended_late or l.status <> 'accepted' then
    return;
  end if;
  -- Already over another way (the teacher ended it, or its time ran out).
  if exists (select 1 from public.meeting_rooms m where m.id = l.room_id and m.ended_at is not null) then
    return;
  end if;

  select coalesce(array_agg(p.user_id), '{}') into v_joined
    from public.meeting_participants p
   where p.room_id = l.room_id and p.first_admitted_at is not null
     and p.first_admitted_at < l.starts_at + interval '16 minutes';
  v_n := cardinality(v_joined);
  if v_n >= 2 or (v_n = 1 and now() < l.starts_at + interval '16 minutes') then
    return;
  end if;
  if v_n = 1 then
    v_late := case when v_joined[1] = l.teacher_id then l.student_id else l.teacher_id end;
  end if;

  update public.lessons x
     set ended_late = true, late_user = v_late,
         ended_late_at = l.starts_at + case when v_n = 0 then interval '15 minutes' else interval '16 minutes' end
   where x.id = l.id;
  update public.meeting_rooms m set ended_at = now() where m.id = l.room_id and m.ended_at is null;
  delete from public.meeting_signals s where s.room_id = l.room_id;
  if l.room_id is not null then
    perform public.meeting_nudge(public.meeting_present(l.room_id));
  end if;
end;
$$;

revoke all on function public.lesson_settle(uuid) from public, anon, authenticated;

-- Same as before, and: the room of a lesson is checked for lateness first,
-- so every meeting function sees a lesson that has ended as ended.
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
    select * into r from public.meeting_rooms m where m.id = r.id;
  end if;
  if r.id is not null and r.ended_at is null and r.expires_at <= now() then
    update public.meeting_rooms m set ended_at = m.expires_at
     where m.id = r.id and m.ended_at is null;
    r.ended_at := r.expires_at;
  end if;
  return r;
end;
$$;

-- Same as before, without lessons that ended because of being late.
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
           and case when m.id is null then now() < l.starts_at + interval '3 hours'
                    else m.ended_at is null and m.expires_at > now() end)
     )
   order by l.starts_at
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Calling off and moving
-- ---------------------------------------------------------------------------

-- A proposal: whoever made it takes it back.
-- An agreed lesson before its time: called off at once; the other gets a
-- message.
-- An agreed lesson running for 10 minutes or more, where the caller came
-- and the other didn't: ends as "the other was late".
create or replace function public.lesson_cancel(p_lesson uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_other  uuid;
  l        public.lessons;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'signed_out');
  end if;
  select * into l from public.lessons x
   where x.id = p_lesson and v_me in (x.teacher_id, x.student_id) for update;
  if l.id is null or l.starts_at is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_other := case when l.teacher_id = v_me then l.student_id else l.teacher_id end;

  if l.status = 'proposed' then
    if l.proposed_by <> v_me then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    update public.lessons x set status = 'cancelled', decided_at = now() where x.id = l.id;
    if l.starts_at > now() and public.can_message(v_other) then
      insert into public.messages (sender_id, recipient_id, body)
      values (v_me, v_other, 'Atsiimu pasiūlymą: ' || public.lesson_time_text(l.starts_at) || '.');
    end if;
    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;

  if l.status <> 'accepted' or l.ended_late then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if now() < l.starts_at then
    update public.lessons x
       set status = 'cancelled', decided_at = now(), reschedule_to = null, reschedule_by = null
     where x.id = l.id;
    update public.meeting_rooms m set ended_at = now() where m.id = l.room_id and m.ended_at is null;
    if l.room_id is not null then
      delete from public.meeting_signals s where s.room_id = l.room_id;
      perform public.meeting_nudge(public.meeting_present(l.room_id));
    end if;
    if public.can_message(v_other) then
      insert into public.messages (sender_id, recipient_id, body)
      values (v_me, v_other, 'Atšaukiu pamoką: ' || public.lesson_time_text(l.starts_at) || '.');
    end if;
    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;

  -- The lesson has started.
  if now() < l.starts_at + interval '10 minutes' then
    return jsonb_build_object('ok', false, 'error', 'started');
  end if;
  if l.room_id is null
     or not exists (select 1 from public.meeting_participants p
                     where p.room_id = l.room_id and p.user_id = v_me and p.first_admitted_at is not null)
     or exists (select 1 from public.meeting_participants p
                 where p.room_id = l.room_id and p.user_id = v_other and p.first_admitted_at is not null)
     or exists (select 1 from public.meeting_rooms m where m.id = l.room_id and m.ended_at is not null) then
    return jsonb_build_object('ok', false, 'error', 'started');
  end if;
  update public.lessons x set ended_late = true, late_user = v_other, ended_late_at = now() where x.id = l.id;
  update public.meeting_rooms m set ended_at = now() where m.id = l.room_id and m.ended_at is null;
  delete from public.meeting_signals s where s.room_id = l.room_id;
  return jsonb_build_object('ok', true, 'late', true);
end;
$$;

-- Proposes moving an agreed lesson to p_starts_at. Nothing changes until
-- the other agrees (lesson_reschedule_answer). A new proposal replaces the
-- caller's earlier one.
create function public.lesson_reschedule(p_lesson uuid, p_starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_gate   text := public.meeting_gate();
  v_other  uuid;
  l        public.lessons;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  select * into l from public.lessons x
   where x.id = p_lesson and v_me in (x.teacher_id, x.student_id) for update;
  if l.id is null or l.status <> 'accepted' or l.starts_at is null or l.ended_late then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  -- Once it can be joined, it is too late to move it.
  if now() >= l.starts_at - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'error', 'started');
  end if;
  if p_starts_at is null or p_starts_at < now() + interval '5 minutes' or p_starts_at > now() + interval '1 year'
     or p_starts_at = l.starts_at then
    return jsonb_build_object('ok', false, 'error', 'bad_time');
  end if;
  v_other := case when l.teacher_id = v_me then l.student_id else l.teacher_id end;
  -- The other already proposed a time: answer that first.
  if l.reschedule_by = v_other then
    return jsonb_build_object('ok', false, 'error', 'already');
  end if;
  if not public.can_message(v_other) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;
  if not public.meeting_allow(v_me, 'lesson', interval '1 hour', 20) then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  update public.lessons x set reschedule_to = p_starts_at, reschedule_by = v_me where x.id = l.id;
  insert into public.messages (sender_id, recipient_id, body, lesson_id, lesson_event, lesson_at)
  values (v_me, v_other, 'Siūlau perkelti pamoką į ' || public.lesson_time_text(p_starts_at) || '.', l.id, 'reschedule', p_starts_at);
  return jsonb_build_object('ok', true);
end;
$$;

-- Agrees (true) or refuses (false) to move the lesson to the proposed time.
create function public.lesson_reschedule_answer(p_lesson uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  l     public.lessons;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'signed_out');
  end if;
  select * into l from public.lessons x
   where x.id = p_lesson and v_me in (x.teacher_id, x.student_id) for update;
  if l.id is null or l.status <> 'accepted' or l.ended_late or l.reschedule_by is null or l.reschedule_by = v_me then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if coalesce(p_accept, false) then
    if l.reschedule_to < now() + interval '1 minute' then
      return jsonb_build_object('ok', false, 'error', 'over');
    end if;
    -- A call already made for the old time goes; a new one is made in time.
    update public.meeting_rooms m set ended_at = now() where m.id = l.room_id and m.ended_at is null;
    update public.lessons x
       set starts_at = l.reschedule_to, room_id = null, reschedule_to = null, reschedule_by = null
     where x.id = l.id;
  else
    update public.lessons x set reschedule_to = null, reschedule_by = null where x.id = l.id;
  end if;

  if public.can_message(l.reschedule_by) then
    insert into public.messages (sender_id, recipient_id, body)
    values (v_me, l.reschedule_by,
            case when coalesce(p_accept, false) then 'Sutinku. Pamoka perkelta: ' || public.lesson_time_text(l.reschedule_to) || '.'
                 else 'Nesutinku perkelti pamokos į ' || public.lesson_time_text(l.reschedule_to) || '.' end);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.lesson_reschedule(uuid, timestamptz)       from public, anon, authenticated;
revoke all on function public.lesson_reschedule_answer(uuid, boolean)    from public, anon, authenticated;
grant execute on function public.lesson_reschedule(uuid, timestamptz)    to authenticated;
grant execute on function public.lesson_reschedule_answer(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Opening a lesson and listing lessons, now aware of being late
-- ---------------------------------------------------------------------------

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
  select * into l from public.lessons x where x.id = p_lesson for update;

  v_other := case when l.teacher_id = v_me then l.student_id else l.teacher_id end;
  select jsonb_build_object('id', o.id, 'name', o.full_name, 'username', o.username, 'avatar', o.avatar)
    into v_partner from public.profiles o where o.id = v_other;

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
    if now() > coalesce(l.starts_at, l.created_at) + interval '3 hours' then
      return jsonb_build_object('ok', false, 'error', 'over');
    end if;
    v_code := public.lesson_make_room(l.id);
  else
    select m.code into v_code from public.meeting_rooms m where m.id = l.room_id;
  end if;

  r := public.meeting_find(v_code);
  if r.id is null or r.ended_at is not null then
    return jsonb_build_object('ok', false, 'error', 'over');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', r.code,
    'starts_at', l.starts_at,
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
                 l.reschedule_by, l.reschedule_to, l.ended_late, l.late_user,
                 case
                   when l.ended_late then 'late'
                   when l.status = 'proposed' and l.starts_at <= now() then 'expired'
                   when l.status <> 'accepted' then l.status
                   when m.id is not null and (m.ended_at is not null or m.expires_at <= now()) then 'over'
                   when m.id is null and now() > coalesce(l.starts_at, l.created_at) + interval '3 hours' then 'over'
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
-- Notifications on the website
-- ---------------------------------------------------------------------------

-- What to show the signed-in student in the corner of the website:
--  * messages they received after p_since (empty p_since: none, only the
--    counts), with how many are still unread,
--  * lesson moments from the last day, each with when it happened (at):
--      open          the lesson can be joined (10 minutes before)
--      joined        the other student came into the lesson
--      late5/late10  the student is 5 / 10 minutes late
--      late_ended    the lesson ended because the student was late
--      partner_late  the lesson ended because the other was late
-- The website remembers what it has shown already. now is the database's
-- clock, for asking again next time.
create function public.my_notifications(p_since timestamptz default null)
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
    where v_me in (l.teacher_id, l.student_id)
      and l.status = 'accepted' and not l.ended_late
      and l.starts_at between now() - interval '1 day' and now() - interval '15 minutes';

  return jsonb_build_object(
    'ok', true,
    'now', now(),
    'unread', (select count(*)::int from public.messages m where m.recipient_id = v_me and m.read_at is null),
    'unread_new', (select count(*)::int from public.messages m
                    where m.recipient_id = v_me and m.read_at is null and m.deleted_at is null
                      and (p_since is null or m.created_at > p_since)),
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'from', q.sender_id, 'name', q.full_name, 'body', q.body,
               'event', q.lesson_event, 'lesson', q.lesson_id, 'at', q.created_at, 'read', q.read
             ) order by q.created_at), '[]'::jsonb)
        from (
          select m.id, m.sender_id, p.full_name, left(m.body, 160) as body, m.lesson_event, m.lesson_id,
                 m.created_at, m.read_at is not null as read
            from public.messages m
            join public.profiles p on p.id = m.sender_id
           where p_since is not null and m.recipient_id = v_me and m.deleted_at is null
             and m.created_at > p_since
           order by m.created_at desc
           limit 20
        ) q
    ),
    'events', (
      with mine as (
        select l.*,
               case when l.teacher_id = v_me then l.student_id else l.teacher_id end as partner,
               (select p.first_admitted_at from public.meeting_participants p
                 where p.room_id = l.room_id and p.user_id = v_me) as me_at,
               (select p.first_admitted_at from public.meeting_participants p
                 where p.room_id = l.room_id and p.user_id = case when l.teacher_id = v_me then l.student_id else l.teacher_id end) as them_at,
               (select m.ended_at from public.meeting_rooms m where m.id = l.room_id) as room_ended
          from public.lessons l
         where v_me in (l.teacher_id, l.student_id)
           and l.status = 'accepted'
           and coalesce(l.starts_at, l.created_at) between now() - interval '1 day' and now() + interval '1 day'
      ),
      ev as (
        select id, partner, 'open' as kind, starts_at - interval '10 minutes' as at from mine
         where starts_at is not null and not ended_late and room_ended is null and me_at is null
           and now() >= starts_at - interval '10 minutes' and now() < starts_at + interval '15 minutes'
        union all
        select id, partner, 'late5', starts_at + interval '5 minutes' from mine
         where starts_at is not null and not ended_late and room_ended is null and me_at is null
           and now() >= starts_at + interval '5 minutes'
        union all
        select id, partner, 'late10', starts_at + interval '10 minutes' from mine
         where starts_at is not null and not ended_late and room_ended is null and me_at is null
           and now() >= starts_at + interval '10 minutes'
        union all
        select id, partner, 'joined', them_at from mine
         where them_at is not null and not ended_late and room_ended is null
        union all
        select id, partner, 'late_ended', ended_late_at from mine
         where ended_late and (late_user is null or late_user = v_me)
        union all
        select id, partner, 'partner_late', ended_late_at from mine
         where ended_late and late_user = partner
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', ev.kind, 'lesson', ev.id, 'at', ev.at, 'partner', ev.partner, 'name', p.full_name
             ) order by ev.at), '[]'::jsonb)
        from ev join public.profiles p on p.id = ev.partner
    )
  );
end;
$$;

revoke all on function public.my_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.my_notifications(timestamptz) to authenticated;
