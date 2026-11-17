-- Lessons (pamoka.html): one-on-one video sessions between a teacher and a
-- student. Run once, after 2026-11-13-meetings.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- A lesson uses the same video call as a meeting, with different rules:
--  * It only exists between two students who can write to each other, and
--    is only reachable from their chat. Nobody else can enter it, see it or
--    find it, with or without its address.
--  * The teacher of the two is always in charge of the call (can switch the
--    other's microphone off, end the lesson). If both teach, it is the one
--    who asked for the lesson.
--  * "Now": one of them invites, the other gets the invitation in the chat
--    and joins with one button.
--  * "Later": one proposes a day and time (at most a year ahead), the other
--    agrees or declines. Once agreed, the lesson opens by itself 10 minutes
--    before that time and stays open for 3 hours after it.
--  * Everything else (blocks, school subscription, reports, no recording,
--    deleting after 30 days) works as for meetings.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A meeting room is either an open meeting or the room of one lesson, which
-- only its teacher (owner_id) and student (guest_id) can enter.
alter table public.meeting_rooms
  add column kind text not null default 'open' check (kind in ('open', 'lesson')),
  add column guest_id uuid references public.profiles (id) on delete cascade;

create table public.lessons (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null references public.profiles (id) on delete cascade,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  proposed_by  uuid not null references public.profiles (id) on delete cascade,
  -- Empty for a lesson that starts right away.
  starts_at    timestamptz,
  status       text not null check (status in ('proposed', 'accepted', 'declined', 'cancelled')),
  -- Made when the lesson opens (10 minutes before starts_at).
  room_id      uuid references public.meeting_rooms (id) on delete set null,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  check (teacher_id <> student_id),
  check (proposed_by in (teacher_id, student_id))
);

create index lessons_pair on public.lessons (teacher_id, student_id, created_at desc);
create index lessons_student on public.lessons (student_id);

alter table public.lessons enable row level security;
revoke all on public.lessons from public, anon, authenticated;

-- An invitation or proposal shows up in the chat as a message that carries
-- the lesson. Students can read this column but never set it themselves
-- (they may only insert recipient_id and body).
alter table public.messages
  add column lesson_id uuid references public.lessons (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Helpers (not callable through the website's key)
-- ---------------------------------------------------------------------------

-- "2026-11-14 16:00", Lithuanian time, for the text of chat messages.
create function public.lesson_time_text(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_at at time zone 'Europe/Vilnius', 'YYYY-MM-DD HH24:MI');
$$;

-- Makes the room of a lesson and returns its code.
create function public.lesson_make_room(p_lesson uuid)
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
    values (v_code, l.teacher_id, l.student_id, 'lesson', coalesce(l.starts_at, now()) + interval '3 hours')
    on conflict do nothing
    returning id into v_room;
    exit when v_room is not null;
  end loop;
  update public.lessons x set room_id = v_room where x.id = p_lesson;
  return v_code;
end;
$$;

revoke all on function public.lesson_time_text(timestamptz) from public, anon, authenticated;
revoke all on function public.lesson_make_room(uuid)        from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the chat (zinutes.html) and the lesson page (pamoka.html) call
-- ---------------------------------------------------------------------------

-- Invites p_partner to a lesson right now (p_starts_at empty) or proposes a
-- time. The other student sees it in the chat. At most 20 an hour.
create function public.lesson_request(p_partner uuid, p_starts_at timestamptz default null)
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
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  -- Same rule as for writing a message (school subscription, blocks, and
  -- that the two are in touch at all).
  if p_partner is null or not public.can_message(p_partner) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  -- The teacher of the two is in charge; if both teach, whoever asks.
  if exists (select 1 from public.teacher_profiles t where t.id = v_me) then
    v_teacher := v_me;
    v_student := p_partner;
  elsif exists (select 1 from public.teacher_profiles t where t.id = p_partner) then
    v_teacher := p_partner;
    v_student := v_me;
  else
    return jsonb_build_object('ok', false, 'error', 'no_teacher');
  end if;

  if p_starts_at is not null
     and (p_starts_at < now() + interval '5 minutes' or p_starts_at > now() + interval '1 year') then
    return jsonb_build_object('ok', false, 'error', 'bad_time');
  end if;

  -- One at a time per pair, so two requests can't cross.
  perform pg_advisory_xact_lock(hashtextextended(least(v_me, p_partner)::text || greatest(v_me, p_partner)::text, 0));

  if p_starts_at is null then
    -- A lesson between the two that is open right now is simply used again.
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
  elsif (select count(*) from public.lessons l
          where l.teacher_id in (v_me, p_partner) and l.student_id in (v_me, p_partner)
            and l.status = 'proposed' and l.starts_at > now()) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;

  if not public.meeting_allow(v_me, 'lesson', interval '1 hour', 20) then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  perform public.meeting_cleanup_if_due();

  insert into public.lessons (teacher_id, student_id, proposed_by, starts_at, status, decided_at)
  values (v_teacher, v_student, v_me, p_starts_at,
          case when p_starts_at is null then 'accepted' else 'proposed' end,
          case when p_starts_at is null then now() end)
  returning id into v_id;
  if p_starts_at is null then
    perform public.lesson_make_room(v_id);
  end if;

  insert into public.messages (sender_id, recipient_id, body, lesson_id)
  values (v_me, p_partner,
          case when p_starts_at is null then 'Kviečiu į pamoką dabar.'
               else 'Siūlau pamoką: ' || public.lesson_time_text(p_starts_at) || '.' end,
          v_id);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Agrees to (true) or declines (false) a time the other student proposed.
create function public.lesson_answer(p_lesson uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  l       public.lessons;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  select * into l from public.lessons x
   where x.id = p_lesson and v_me in (x.teacher_id, x.student_id) for update;
  if l.id is null or l.proposed_by = v_me or l.status <> 'proposed' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if coalesce(p_accept, false) and l.starts_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'over');
  end if;
  if coalesce(p_accept, false) and public.is_blocked_between(l.teacher_id, l.student_id) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  update public.lessons x
     set status = case when coalesce(p_accept, false) then 'accepted' else 'declined' end, decided_at = now()
   where x.id = l.id;

  if public.can_message(l.proposed_by) then
    insert into public.messages (sender_id, recipient_id, body)
    values (v_me, l.proposed_by,
            case when coalesce(p_accept, false) then 'Sutinku. Pamoka: ' else 'Šis laikas man netinka: ' end
            || public.lesson_time_text(l.starts_at) || '.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Takes back a proposal, or calls off a lesson that was agreed. Either of
-- the two can. A lesson that is running ends.
create function public.lesson_cancel(p_lesson uuid)
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
  if l.id is null or l.status not in ('proposed', 'accepted') or l.starts_at is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.lessons x set status = 'cancelled', decided_at = now() where x.id = l.id;
  update public.meeting_rooms m set ended_at = now() where m.id = l.room_id and m.ended_at is null;

  v_other := case when l.teacher_id = v_me then l.student_id else l.teacher_id end;
  if l.starts_at > now() and public.can_message(v_other) then
    insert into public.messages (sender_id, recipient_id, body)
    values (v_me, v_other, 'Atšaukiu pamoką: ' || public.lesson_time_text(l.starts_at) || '.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- The lessons between the caller and p_partner, newest first, for showing
-- them in the chat. state is what can be done with each one right now:
--   proposed | declined | cancelled | expired (nobody answered in time)
--   upcoming (agreed, not open yet) | open (can be joined) | over
create function public.lesson_list(p_partner uuid)
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
  return jsonb_build_object(
    'ok', true,
    -- Whether a new lesson can be asked for: the two can write to each
    -- other and at least one of them teaches.
    'can_request', public.meeting_gate() is null and public.can_message(p_partner) and exists (
      select 1 from public.teacher_profiles t where t.id in (v_me, p_partner)
    ),
    'lessons', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'starts_at', q.starts_at, 'by_me', q.proposed_by = v_me,
               'i_teach', q.teacher_id = v_me, 'state', q.state
             ) order by q.created_at desc), '[]'::jsonb)
        from (
          select l.id, l.starts_at, l.proposed_by, l.teacher_id, l.created_at,
                 case
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
           order by l.created_at desc
           limit 100
        ) q
    )
  );
end;
$$;

-- Opens a lesson for one of its two students: answers with the code of its
-- call (making the call if this is the first of them to arrive), and who
-- the other one is. Too early, called off, over, or someone else's lesson:
-- no code.
create function public.lesson_open(p_lesson uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_gate   text := public.meeting_gate();
  l        public.lessons;
  r        public.meeting_rooms;
  v_code   text;
  v_other  uuid;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  select * into l from public.lessons x
   where x.id = p_lesson and v_me in (x.teacher_id, x.student_id) for update;
  if l.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
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

  v_other := case when l.teacher_id = v_me then l.student_id else l.teacher_id end;
  return jsonb_build_object(
    'ok', true,
    'code', r.code,
    'starts_at', l.starts_at,
    'i_teach', l.teacher_id = v_me,
    'partner', (
      select jsonb_build_object('id', o.id, 'name', o.full_name, 'username', o.username, 'avatar', o.avatar)
        from public.profiles o where o.id = v_other
    )
  );
end;
$$;

revoke all on function public.lesson_request(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.lesson_answer(uuid, boolean)      from public, anon, authenticated;
revoke all on function public.lesson_cancel(uuid)               from public, anon, authenticated;
revoke all on function public.lesson_list(uuid)                 from public, anon, authenticated;
revoke all on function public.lesson_open(uuid)                 from public, anon, authenticated;

grant execute on function public.lesson_request(uuid, timestamptz) to authenticated;
grant execute on function public.lesson_answer(uuid, boolean)      to authenticated;
grant execute on function public.lesson_cancel(uuid)               to authenticated;
grant execute on function public.lesson_list(uuid)                 to authenticated;
grant execute on function public.lesson_open(uuid)                 to authenticated;

-- ---------------------------------------------------------------------------
-- The meeting functions, taught about lesson rooms. Same as in
-- 2026-11-13-meetings.sql except where a comment says "Lesson".
-- ---------------------------------------------------------------------------

-- Lessons are not listed among a student's own meetings.
create or replace function public.meeting_mine()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_gate text := public.meeting_gate();
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  return jsonb_build_object('ok', true, 'rooms', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', m.code,
             'title', m.title,
             'created_at', m.created_at,
             'expires_at', m.expires_at,
             'present', cardinality(public.meeting_present(m.id))
           ) order by m.created_at desc), '[]'::jsonb)
      from public.meeting_rooms m
     where m.owner_id = v_me and m.kind = 'open' and m.ended_at is null and m.expires_at > now()
  ));
end;
$$;

create or replace function public.meeting_info(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_gate text := public.meeting_gate();
  r      public.meeting_rooms;
  v_mine boolean;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  if (select count(*) from public.meeting_actions a
       where a.user_id = v_me and a.action = 'miss' and a.at > now() - interval '1 hour') >= 40 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  r := public.meeting_find(p_code);
  -- Lesson: for anyone but its two students it doesn't exist.
  if r.id is null or (r.kind = 'lesson' and v_me not in (r.owner_id, r.guest_id)) then
    insert into public.meeting_actions (user_id, action) values (v_me, 'miss');
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_mine := r.owner_id = v_me;
  if not v_mine and public.is_blocked_between(v_me, r.owner_id) then
    return jsonb_build_object('ok', false, 'error', 'refused');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', r.code,
    'title', r.title,
    'mine', v_mine,
    'ended', r.ended_at is not null,
    'locked', r.locked,
    'expires_at', r.expires_at,
    'present', cardinality(public.meeting_present(r.id)),
    'max', (select s.max_participants from public.meeting_settings s),
    'status', (select p.status from public.meeting_participants p where p.room_id = r.id and p.user_id = v_me),
    'was_inside', coalesce((select p.first_admitted_at is not null
                              from public.meeting_participants p
                             where p.room_id = r.id and p.user_id = v_me), false),
    'owner', (
      select jsonb_build_object(
               'id', o.id, 'name', o.full_name, 'username', o.username, 'avatar', o.avatar,
               'grade', o.grade, 'school', s.name)
        from public.profiles o
        join public.schools s on s.id = o.school_id
       where o.id = r.owner_id
    )
  );
end;
$$;

create or replace function public.meeting_join(p_code text, p_conn uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  r       public.meeting_rooms;
  p       public.meeting_participants;
  v_seq   bigint;
  v_max   int;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  if p_conn is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  r := public.meeting_find(p_code);
  -- Lesson: for anyone but its two students it doesn't exist.
  if r.id is null or (r.kind = 'lesson' and v_me not in (r.owner_id, r.guest_id)) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if r.ended_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ended');
  end if;
  perform public.meeting_cleanup_if_due();

  -- One at a time per meeting, so two students can't take the last seat.
  perform 1 from public.meeting_rooms m where m.id = r.id for no key update;

  select * into p from public.meeting_participants x where x.room_id = r.id and x.user_id = v_me;
  v_seq := nextval('public.meeting_join_seq');

  -- The organizer walks straight in.
  if v_me = r.owner_id then
    insert into public.meeting_participants as x (room_id, user_id, status, conn, seq, first_admitted_at)
    values (r.id, v_me, 'admitted', p_conn, v_seq, now())
    on conflict (room_id, user_id) do update
      set status = 'admitted', conn = excluded.conn, seq = excluded.seq, left_at = null,
          last_seen_at = now(), first_admitted_at = coalesce(x.first_admitted_at, now());
    perform public.meeting_nudge(public.meeting_present(r.id, v_me));
    return jsonb_build_object('ok', true, 'status', 'admitted', 'seq', v_seq, 'owner', r.owner_id);
  end if;

  if p.status = 'removed' then
    return jsonb_build_object('ok', false, 'error', 'removed');
  end if;
  if p.status = 'denied' and p.denials >= 3 then
    return jsonb_build_object('ok', false, 'error', 'denied');
  end if;

  -- Never together with someone they blocked or who blocked them. The
  -- answer doesn't say which of the two it is, or who.
  if public.is_blocked_between(v_me, r.owner_id) or exists (
       select 1 from unnest(public.meeting_present(r.id, v_me)) as other (id)
        where public.is_blocked_between(v_me, other.id)
     ) then
    return jsonb_build_object('ok', false, 'error', 'refused');
  end if;

  -- Lesson: the student it was made for walks in too; nobody has to let
  -- them in, and nobody else can ask.
  if r.kind = 'lesson' then
    insert into public.meeting_participants as x (room_id, user_id, status, conn, seq, first_admitted_at)
    values (r.id, v_me, 'admitted', p_conn, v_seq, now())
    on conflict (room_id, user_id) do update
      set status = 'admitted', conn = excluded.conn, seq = excluded.seq, left_at = null,
          last_seen_at = now(), first_admitted_at = coalesce(x.first_admitted_at, now());
    perform public.meeting_nudge(public.meeting_present(r.id, v_me));
    return jsonb_build_object('ok', true, 'status', 'admitted', 'seq', v_seq, 'owner', r.owner_id);
  end if;

  -- Someone the organizer already let in comes back without asking again
  -- (a reloaded page, a dropped connection).
  if p.first_admitted_at is not null and p.status in ('admitted', 'left') then
    select s.max_participants into v_max from public.meeting_settings s;
    if cardinality(public.meeting_present(r.id, v_me)) >= v_max then
      return jsonb_build_object('ok', false, 'error', 'full');
    end if;
    update public.meeting_participants x
       set status = 'admitted', conn = p_conn, seq = v_seq, left_at = null, last_seen_at = now()
     where x.room_id = r.id and x.user_id = v_me;
    perform public.meeting_nudge(public.meeting_present(r.id, v_me));
    return jsonb_build_object('ok', true, 'status', 'admitted', 'seq', v_seq, 'owner', r.owner_id);
  end if;

  -- Everyone else asks first.
  if r.locked then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  if p.status = 'waiting' then
    -- Already asking (e.g. the page was reloaded): keep their place.
    update public.meeting_participants x
       set conn = p_conn, seq = v_seq, last_seen_at = now()
     where x.room_id = r.id and x.user_id = v_me;
  else
    if not public.meeting_allow(v_me, 'knock', interval '1 hour', 30) then
      return jsonb_build_object('ok', false, 'error', 'limit');
    end if;
    insert into public.meeting_participants as x (room_id, user_id, status, conn, seq)
    values (r.id, v_me, 'waiting', p_conn, v_seq)
    on conflict (room_id, user_id) do update
      set status = 'waiting', conn = excluded.conn, seq = excluded.seq, left_at = null,
          asked_at = now(), last_seen_at = now();
  end if;
  perform public.meeting_nudge(array[r.owner_id]);
  return jsonb_build_object('ok', true, 'status', 'waiting', 'seq', v_seq, 'owner', r.owner_id);
end;
$$;

create or replace function public.meeting_sync(
  p_code        text,
  p_conn        uuid,
  p_ack         bigint[] default '{}',
  p_chat_after  bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_gate   text := public.meeting_gate();
  r        public.meeting_rooms;
  p        public.meeting_participants;
  v_owner  boolean;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;

  r := public.meeting_find(p_code);
  select * into p from public.meeting_participants x where x.room_id = r.id and x.user_id = v_me;
  if r.id is null or p.user_id is null then
    return jsonb_build_object('ok', true, 'status', 'gone');
  end if;
  if r.ended_at is not null then
    return jsonb_build_object('ok', true, 'status', 'ended');
  end if;
  if p.status in ('denied', 'removed', 'left') then
    return jsonb_build_object('ok', true, 'status', p.status);
  end if;
  if p.conn is distinct from p_conn then
    return jsonb_build_object('ok', true, 'status', 'replaced');
  end if;

  if p.last_seen_at < now() - interval '5 seconds' then
    update public.meeting_participants x set last_seen_at = now()
     where x.room_id = r.id and x.user_id = v_me;
  end if;

  if p.status = 'waiting' then
    return jsonb_build_object('ok', true, 'status', 'waiting');
  end if;

  v_owner := r.owner_id = v_me;

  -- A meeting doesn't go on without its organizer: 10 minutes after they
  -- were last seen, it ends for everyone still inside.
  -- Lesson: not so; the student may be the first to arrive and wait.
  if not v_owner and r.kind = 'open' and not exists (
       select 1 from public.meeting_participants o
        where o.room_id = r.id and o.user_id = r.owner_id
          and o.last_seen_at > now() - interval '10 minutes'
     ) then
    update public.meeting_rooms m set ended_at = now() where m.id = r.id and m.ended_at is null;
    delete from public.meeting_signals s where s.room_id = r.id;
    perform public.meeting_nudge(public.meeting_present(r.id, v_me));
    return jsonb_build_object('ok', true, 'status', 'ended');
  end if;

  delete from public.meeting_signals s
   where s.room_id = r.id and s.to_id = v_me
     and (s.id = any ((coalesce(p_ack, '{}'::bigint[]))[1:500])
          or s.to_conn <> p_conn
          or s.created_at < now() - interval '2 minutes');

  return jsonb_build_object(
    'ok', true,
    'status', 'admitted',
    'seq', p.seq,
    'room', jsonb_build_object(
      'title', r.title,
      'owner', r.owner_id,
      'locked', r.locked,
      'expires_at', r.expires_at,
      'max', (select s.max_participants from public.meeting_settings s)
    ),
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.user_id, 'conn', x.conn, 'seq', x.seq) order by x.seq), '[]'::jsonb)
        from public.meeting_participants x
       where x.room_id = r.id and x.user_id <> v_me and x.status = 'admitted'
         and x.last_seen_at > now() - interval '30 seconds'
    ),
    'waiting', case when v_owner then (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.user_id, 'at', x.asked_at) order by x.asked_at), '[]'::jsonb)
        from public.meeting_participants x
       where x.room_id = r.id and x.status = 'waiting'
         and x.last_seen_at > now() - interval '30 seconds'
    ) else '[]'::jsonb end,
    'signals', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'from', q.from_id, 'conn', q.from_conn, 'kind', q.kind, 'data', q.data
             ) order by q.id), '[]'::jsonb)
        from (
          select s.id, s.from_id, s.from_conn, s.kind, s.data
            from public.meeting_signals s
           where s.room_id = r.id and s.to_id = v_me and s.to_conn = p_conn
           order by s.id
           limit 200
        ) q
    ),
    'chat', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'from', q.sender_id, 'body', q.body, 'at', q.created_at
             ) order by q.id), '[]'::jsonb)
        from (
          select c.id, c.sender_id, c.body, c.created_at
            from public.meeting_messages c
           where c.room_id = r.id and c.id > coalesce(p_chat_after, 0)
             and c.created_at >= p.first_admitted_at
           order by c.id
           limit 200
        ) q
    )
  );
end;
$$;
