-- Meetings (susitikimai.html): students meet in a video call to study
-- together. Run once, after 2026-11-12-security-hardening.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- Sound and picture travel between the students' browsers, encrypted from
-- one browser to the other. They are never stored or recorded, and Mokify
-- itself cannot see or hear them. The database only decides who may be in a
-- meeting and passes along the short technical notes browsers need to find
-- each other.
--
-- Rules:
--  * Only signed-in students of a school with a running subscription can
--    create or enter a meeting. There are no guest links: a link or code is
--    useless without a Mokify account.
--  * The student who creates a meeting is its organizer. Everyone else asks
--    to come in and waits until the organizer lets them in. The organizer
--    sees their real name, school and class first.
--  * The organizer can refuse someone, remove them (no way back into that
--    meeting), lock the meeting against new requests, and end it for all.
--  * Students who blocked each other are never put in the same meeting.
--  * Names and pictures in a meeting always come from the Mokify profile.
--    Nobody can type in another name, and nobody can pretend to be another
--    participant: the database stamps every note with who really sent it.
--  * Anyone in a meeting can report another participant (meeting_reports).
--  * A meeting holds up to 6 students and its link works for 24 hours. It
--    also ends once the organizer has been away for 10 minutes while others
--    are still in it.
--  * Who took part and what was written in the meeting's chat is deleted
--    30 days after the meeting ended, unless a report about it is still open.
--  * Like blocks, every table here is only used through the functions below;
--    the website's key can't read or change them directly.
--
-- For Mokify, in the SQL editor:
--   Reports waiting to be looked at:
--     select * from public.meeting_report_list;
--   What was written in a reported meeting's chat:
--     select m.created_at, p.full_name, m.body
--       from public.meeting_messages m join public.profiles p on p.id = m.sender_id
--      where m.room_id = '<room id>' order by m.id;
--   Mark a report as handled:
--     update public.meeting_reports set status = 'closed', note = '...' where id = '<report id>';
--   Switch all meetings off at once (and on again with true):
--     update public.meeting_settings set enabled = false;
--   Allow fewer or more students in one meeting (2 to 8):
--     update public.meeting_settings set max_participants = 4;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.meeting_settings (
  id                boolean primary key default true check (id),
  enabled           boolean not null default true,
  max_participants  smallint not null default 6 check (max_participants between 2 and 8),
  last_cleanup_at   timestamptz not null default now()
);

insert into public.meeting_settings default values;

-- A meeting's code is 12 random characters without 0/o/1/i/l, shown to
-- students as xxxx-xxxx-xxxx.
create table public.meeting_rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-hjkmnp-z2-9]{12}$'),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  title       text not null default '' check (char_length(title) <= 80),
  locked      boolean not null default false,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours',
  ended_at    timestamptz
);

create index meeting_rooms_owner on public.meeting_rooms (owner_id) where ended_at is null;

-- Decides which of two browsers starts the connection between them (the one
-- that came in later), so they never both start at once.
create sequence public.meeting_join_seq;

-- One row per student per meeting: asking to come in, inside, or gone.
create table public.meeting_participants (
  room_id            uuid not null references public.meeting_rooms (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  status             text not null check (status in ('waiting', 'admitted', 'denied', 'removed', 'left')),
  -- The browser tab that holds this seat. Opening the meeting in a second
  -- tab takes the seat over; the first tab is told and steps out.
  conn               uuid not null,
  seq                bigint not null default nextval('public.meeting_join_seq'),
  asked_at           timestamptz not null default now(),
  first_admitted_at  timestamptz,
  left_at            timestamptz,
  -- Updated every few seconds while the tab is open. Someone not seen for
  -- 30 seconds counts as gone until they show up again.
  last_seen_at       timestamptz not null default now(),
  denials            smallint not null default 0,
  -- Rate limits: connection notes and chat messages in the current minute.
  signal_minute      timestamptz not null default now(),
  signal_count       int not null default 0,
  chat_minute        timestamptz not null default now(),
  chat_count         int not null default 0,
  primary key (room_id, user_id)
);

create index meeting_participants_user on public.meeting_participants (user_id);

-- The technical notes two browsers exchange to connect (WebRTC offers,
-- answers and network addresses). Each is deleted as soon as it was read,
-- and after two minutes at the latest.
create table public.meeting_signals (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.meeting_rooms (id) on delete cascade,
  from_id     uuid not null,
  from_conn   uuid not null,
  to_id       uuid not null,
  to_conn     uuid not null,
  kind        text not null check (kind in ('offer', 'answer', 'ice', 'ctl')),
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

create index meeting_signals_inbox on public.meeting_signals (room_id, to_id, id);

-- The chat inside a meeting.
create table public.meeting_messages (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.meeting_rooms (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(btrim(body, E' \t\r\n')) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index meeting_messages_room on public.meeting_messages (room_id, id);

-- Reports from students. They stay even when the meeting or an account is
-- deleted, until Mokify removes them.
create table public.meeting_reports (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid references public.meeting_rooms (id) on delete set null,
  room_code    text not null,
  reporter_id  uuid references public.profiles (id) on delete set null,
  reported_id  uuid references public.profiles (id) on delete set null,
  reason       text not null check (reason in ('bullying', 'inappropriate', 'stranger', 'other')),
  details      text not null default '' check (char_length(details) <= 1000),
  -- Everyone who was in the meeting when the report was sent.
  present      uuid[] not null default '{}',
  created_at   timestamptz not null default now(),
  status       text not null default 'new' check (status in ('new', 'reviewing', 'closed')),
  -- Mokify's own notes about what was done.
  note         text
);

create index meeting_reports_open on public.meeting_reports (created_at) where status <> 'closed';

-- When each student did something that is limited per hour (creating
-- meetings, asking to come in, wrong codes, reports).
create table public.meeting_actions (
  user_id  uuid not null,
  action   text not null,
  at       timestamptz not null default now()
);

create index meeting_actions_recent on public.meeting_actions (user_id, action, at desc);

alter table public.meeting_settings     enable row level security;
alter table public.meeting_rooms        enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.meeting_signals      enable row level security;
alter table public.meeting_messages     enable row level security;
alter table public.meeting_reports      enable row level security;
alter table public.meeting_actions      enable row level security;

revoke all on public.meeting_settings     from public, anon, authenticated;
revoke all on public.meeting_rooms        from public, anon, authenticated;
revoke all on public.meeting_participants from public, anon, authenticated;
revoke all on public.meeting_signals      from public, anon, authenticated;
revoke all on public.meeting_messages     from public, anon, authenticated;
revoke all on public.meeting_reports      from public, anon, authenticated;
revoke all on public.meeting_actions      from public, anon, authenticated;
revoke all on sequence public.meeting_join_seq from public, anon, authenticated;

-- Reports with names instead of ids, for reading in the SQL editor.
create view public.meeting_report_list
with (security_invoker = true)
as
  select r.id, r.created_at, r.status, r.reason, r.details,
         reported.full_name as reported, reported.username as reported_username,
         reporter.full_name as reporter, reporter.username as reporter_username,
         r.room_id, r.room_code, m.title as room_title,
         (select array_agg(p.full_name order by p.full_name)
            from public.profiles p where p.id = any (r.present)) as present,
         r.note
    from public.meeting_reports r
    left join public.profiles reported on reported.id = r.reported_id
    left join public.profiles reporter on reporter.id = r.reporter_id
    left join public.meeting_rooms m on m.id = r.room_id
   where r.status <> 'closed'
   order by r.created_at;

revoke all on public.meeting_report_list from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers. Only the functions further down use these; the website's key
-- cannot call them.
-- ---------------------------------------------------------------------------

-- Why the signed-in student can't use meetings right now, or null when they
-- can: 'signed_out', 'disabled' (switched off in meeting_settings) or
-- 'inactive' (the school's subscription ended).
create function public.meeting_gate()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then 'signed_out'
    when not (select s.enabled from public.meeting_settings s) then 'disabled'
    when not public.has_active_access() then 'inactive'
  end;
$$;

-- Accepts what a student types or pastes ("ABCD-efgh 2345") and returns the
-- stored form.
create function public.normalize_meeting_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create function public.new_meeting_code()
returns text
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_code text := '';
  b int;
begin
  while length(v_code) < 12 loop
    b := get_byte(extensions.gen_random_bytes(1), 0);
    -- 248 = 8 * 31: dropping higher bytes keeps every character equally likely.
    if b < 248 then
      v_code := v_code || substr(alphabet, b % 31 + 1, 1);
    end if;
  end loop;
  return v_code;
end;
$$;

-- Notes that p_user did p_action, unless they already did it p_max times
-- within p_window; then it answers false and the caller refuses.
create function public.meeting_allow(p_user uuid, p_action text, p_window interval, p_max int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.meeting_actions a
       where a.user_id = p_user and a.action = p_action and a.at > now() - p_window) >= p_max then
    return false;
  end if;
  insert into public.meeting_actions (user_id, action) values (p_user, p_action);
  return true;
end;
$$;

-- The meeting with this code (all columns empty when there is none). A
-- meeting whose 24 hours are over is marked as ended on the way.
create function public.meeting_find(p_code text)
returns public.meeting_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.meeting_rooms;
begin
  select * into r from public.meeting_rooms m where m.code = public.normalize_meeting_code(p_code);
  if r.id is not null and r.ended_at is null and r.expires_at <= now() then
    update public.meeting_rooms m set ended_at = m.expires_at
     where m.id = r.id and m.ended_at is null;
    r.ended_at := r.expires_at;
  end if;
  return r;
end;
$$;

-- Tells these students' browsers to check for news right away, through
-- Supabase Realtime. It is only a speed-up: every browser also checks by
-- itself every second or two, so nothing is lost if this doesn't arrive.
create function public.meeting_nudge(p_users uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid;
begin
  foreach u in array p_users loop
    perform realtime.send(jsonb_build_object('t', 'sync'), 'nudge', 'meeting:' || u::text, true);
  end loop;
exception when others then
  null;
end;
$$;

-- Everyone inside the meeting right now, except p_except.
create function public.meeting_present(p_room uuid, p_except uuid default null)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.user_id), '{}')
    from public.meeting_participants p
   where p.room_id = p_room
     and p.status = 'admitted'
     and p.last_seen_at > now() - interval '30 seconds'
     and p.user_id is distinct from p_except;
$$;

-- Housekeeping, run at most once an hour from meeting_create/meeting_join.
create function public.meeting_cleanup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- "where id" because Supabase refuses an update without a where clause
  -- when it comes from the website, even inside a function.
  update public.meeting_settings set last_cleanup_at = now() where id;

  delete from public.meeting_signals where created_at < now() - interval '2 minutes';
  delete from public.meeting_actions where at < now() - interval '2 days';

  update public.meeting_rooms set ended_at = expires_at
   where ended_at is null and expires_at <= now();

  delete from public.meeting_rooms m
   where m.ended_at < now() - interval '30 days'
     and not exists (
       select 1 from public.meeting_reports r
        where r.room_id = m.id and r.status <> 'closed'
     );
end;
$$;

create function public.meeting_cleanup_if_due()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select s.last_cleanup_at from public.meeting_settings s) < now() - interval '1 hour' then
    perform public.meeting_cleanup();
  end if;
end;
$$;

revoke all on function public.meeting_gate()                              from public, anon, authenticated;
revoke all on function public.normalize_meeting_code(text)                from public, anon, authenticated;
revoke all on function public.new_meeting_code()                          from public, anon, authenticated;
revoke all on function public.meeting_allow(uuid, text, interval, int)    from public, anon, authenticated;
revoke all on function public.meeting_find(text)                          from public, anon, authenticated;
revoke all on function public.meeting_nudge(uuid[])                       from public, anon, authenticated;
revoke all on function public.meeting_present(uuid, uuid)                 from public, anon, authenticated;
revoke all on function public.meeting_cleanup()                           from public, anon, authenticated;
revoke all on function public.meeting_cleanup_if_due()                    from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the website calls. Every function answers with {"ok": true, ...} or
-- {"ok": false, "error": "<why>"}.
-- ---------------------------------------------------------------------------

-- Creates a meeting; the caller becomes its organizer. At most 10 an hour.
create function public.meeting_create(p_title text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  v_title text := left(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), 80);
  v_code  text;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  if not public.meeting_allow(v_me, 'create', interval '1 hour', 10) then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  perform public.meeting_cleanup_if_due();

  loop
    v_code := public.new_meeting_code();
    insert into public.meeting_rooms (code, owner_id, title) values (v_code, v_me, v_title)
    on conflict do nothing;
    exit when found;
  end loop;
  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

-- The caller's own meetings that are still open, newest first.
create function public.meeting_mine()
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
     where m.owner_id = v_me and m.ended_at is null and m.expires_at > now()
  ));
end;
$$;

-- What a student sees before coming in: the meeting's title, its organizer
-- and whether it can be entered. Nothing about who else is inside. Wrong
-- codes are counted (40 an hour), so codes can't be found by trying.
create function public.meeting_info(p_code text)
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
  if r.id is null then
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

-- Comes into the meeting (the organizer, and anyone the organizer already
-- let in before) or asks to come in (everyone else). p_conn is a random id
-- the browser tab makes up for itself.
create function public.meeting_join(p_code text, p_conn uuid)
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
  if r.id is null then
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

-- Called every second or two by each open tab. It says "I'm still here" and
-- answers with everything that tab needs to know: who is inside, who is
-- asking to come in (organizer only), new connection notes and new chat
-- messages. p_ack lists the notes that arrived last time, so they can be
-- deleted.
create function public.meeting_sync(
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
  if not v_owner and not exists (
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

-- Name, picture, class and school of people in the caller's meeting, for
-- showing them on screen. Answers only about students who are or were inside
-- that same meeting, and to the organizer also about those asking to come in.
create function public.meeting_people(p_code text, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  r       public.meeting_rooms;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  r := public.meeting_find(p_code);
  if r.id is null or not exists (
       select 1 from public.meeting_participants x
        where x.room_id = r.id and x.user_id = v_me and x.status = 'admitted'
     ) then
    return jsonb_build_object('ok', false, 'error', 'not_inside');
  end if;

  return jsonb_build_object('ok', true, 'people', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', o.id, 'name', o.full_name, 'username', o.username, 'avatar', o.avatar,
             'grade', o.grade, 'school', s.name,
             'teacher', exists (select 1 from public.teacher_profiles t where t.id = o.id)
           )), '[]'::jsonb)
      from public.meeting_participants x
      join public.profiles o on o.id = x.user_id
      join public.schools s on s.id = o.school_id
     where x.room_id = r.id
       and x.user_id = any ((coalesce(p_ids, '{}'::uuid[]))[1:30])
       and (x.first_admitted_at is not null or (x.status = 'waiting' and r.owner_id = v_me))
  ));
end;
$$;

-- Sends connection notes to other participants. p_messages is a list of
-- {"to": <student>, "to_conn": <their tab>, "kind": "offer" | "answer" | "ice" | "ctl", "data": {...}}.
-- The database fills in who sent each one. A note only goes to someone who
-- is inside the same meeting right now; "ctl" notes (the organizer asking
-- someone's browser to switch off the microphone, camera or screen) are
-- only accepted from the organizer.
create function public.meeting_signal(p_code text, p_conn uuid, p_messages jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_gate   text := public.meeting_gate();
  r        public.meeting_rooms;
  v_n      int;
  v_count  int;
  v_sent   int;
  v_to     uuid[];
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  if p_messages is null or jsonb_typeof(p_messages) <> 'array'
     or jsonb_array_length(p_messages) not between 1 and 60 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_n := jsonb_array_length(p_messages);

  r := public.meeting_find(p_code);
  if r.id is null or r.ended_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ended');
  end if;

  -- At most 1500 notes a minute per student (connecting to five others
  -- takes about a hundred).
  update public.meeting_participants x
     set signal_count  = case when x.signal_minute < now() - interval '1 minute' then v_n else x.signal_count + v_n end,
         signal_minute = case when x.signal_minute < now() - interval '1 minute' then now() else x.signal_minute end
   where x.room_id = r.id and x.user_id = v_me and x.status = 'admitted' and x.conn = p_conn
  returning x.signal_count into v_count;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_inside');
  end if;
  if v_count > 1500 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  with sent as (
    insert into public.meeting_signals (room_id, from_id, from_conn, to_id, to_conn, kind, data)
    select r.id, v_me, p_conn, t.user_id, t.conn, m.kind, m.data
      from jsonb_to_recordset(p_messages) as m ("to" uuid, to_conn uuid, kind text, data jsonb)
      join public.meeting_participants t
        on t.room_id = r.id and t.user_id = m."to" and t.conn = m.to_conn
     where t.user_id <> v_me
       and t.status = 'admitted'
       and t.last_seen_at > now() - interval '30 seconds'
       and (m.kind in ('offer', 'answer', 'ice') or (m.kind = 'ctl' and r.owner_id = v_me))
       and jsonb_typeof(m.data) = 'object'
       and octet_length(m.data::text) <= 60000
       -- Someone who stopped reading doesn't pile up notes.
       and (select count(*) from public.meeting_signals q
             where q.room_id = r.id and q.to_id = t.user_id) < 1000
    returning to_id
  )
  select coalesce(array_agg(distinct to_id), '{}'), count(*) into v_to, v_sent from sent;

  perform public.meeting_nudge(v_to);
  return jsonb_build_object('ok', true, 'sent', v_sent);
end;
$$;

-- Organizer: lets in (true) or refuses (false) someone who is asking. After
-- three refusals they can't ask again in this meeting.
create function public.meeting_decide(p_code text, p_user uuid, p_admit boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  r       public.meeting_rooms;
  v_max   int;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  r := public.meeting_find(p_code);
  if r.id is null or r.owner_id <> v_me then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if r.ended_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ended');
  end if;

  perform 1 from public.meeting_rooms m where m.id = r.id for no key update;

  if not exists (
       select 1 from public.meeting_participants x
        where x.room_id = r.id and x.user_id = p_user and x.status = 'waiting'
     ) then
    return jsonb_build_object('ok', false, 'error', 'not_waiting');
  end if;

  if coalesce(p_admit, false) then
    select s.max_participants into v_max from public.meeting_settings s;
    if cardinality(public.meeting_present(r.id, p_user)) >= v_max then
      return jsonb_build_object('ok', false, 'error', 'full');
    end if;
    if exists (
         select 1 from unnest(public.meeting_present(r.id, p_user)) as other (id)
          where public.is_blocked_between(p_user, other.id)
       ) then
      return jsonb_build_object('ok', false, 'error', 'refused');
    end if;
    update public.meeting_participants x
       set status = 'admitted', first_admitted_at = coalesce(x.first_admitted_at, now()), left_at = null
     where x.room_id = r.id and x.user_id = p_user;
  else
    update public.meeting_participants x
       set status = 'denied', denials = x.denials + 1, left_at = now()
     where x.room_id = r.id and x.user_id = p_user;
  end if;

  perform public.meeting_nudge(array[p_user]);
  return jsonb_build_object('ok', true);
end;
$$;

-- Organizer: removes someone from the meeting (inside it or still asking).
-- They can't come back into this meeting.
create function public.meeting_remove(p_code text, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  r       public.meeting_rooms;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  r := public.meeting_find(p_code);
  if r.id is null or r.owner_id <> v_me then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if p_user is null or p_user = v_me then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  update public.meeting_participants x
     set status = 'removed', left_at = now()
   where x.room_id = r.id and x.user_id = p_user and x.status <> 'removed';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_inside');
  end if;
  delete from public.meeting_signals s
   where s.room_id = r.id and (s.to_id = p_user or s.from_id = p_user);

  perform public.meeting_nudge(public.meeting_present(r.id) || p_user);
  return jsonb_build_object('ok', true);
end;
$$;

-- Organizer: locks the meeting (nobody new can ask to come in) or unlocks it.
create function public.meeting_lock(p_code text, p_locked boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  r       public.meeting_rooms;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  r := public.meeting_find(p_code);
  if r.id is null or r.owner_id <> v_me then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if r.ended_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ended');
  end if;
  update public.meeting_rooms m set locked = coalesce(p_locked, false) where m.id = r.id;
  perform public.meeting_nudge(public.meeting_present(r.id, v_me));
  return jsonb_build_object('ok', true, 'locked', coalesce(p_locked, false));
end;
$$;

-- Organizer: ends the meeting for everyone. Its link stops working.
create function public.meeting_end(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  r       public.meeting_rooms;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  r := public.meeting_find(p_code);
  if r.id is null or r.owner_id <> v_me then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  update public.meeting_rooms m set ended_at = now() where m.id = r.id and m.ended_at is null;
  delete from public.meeting_signals s where s.room_id = r.id;
  perform public.meeting_nudge(public.meeting_present(r.id, v_me));
  return jsonb_build_object('ok', true);
end;
$$;

-- Steps out of the meeting (or stops asking to come in).
create function public.meeting_leave(p_code text, p_conn uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  r     public.meeting_rooms;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'signed_out');
  end if;
  r := public.meeting_find(p_code);
  if r.id is null then
    return jsonb_build_object('ok', true);
  end if;
  update public.meeting_participants x
     set status = 'left', left_at = now()
   where x.room_id = r.id and x.user_id = v_me and x.conn = p_conn
     and x.status in ('waiting', 'admitted');
  if found then
    delete from public.meeting_signals s where s.room_id = r.id and s.to_id = v_me;
    perform public.meeting_nudge(public.meeting_present(r.id, v_me) || r.owner_id);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Writes in the meeting's chat. At most 20 messages a minute per student.
create function public.meeting_say(p_code text, p_conn uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_gate   text := public.meeting_gate();
  v_body   text := btrim(coalesce(p_body, ''), E' \t\r\n');
  r        public.meeting_rooms;
  v_count  int;
  v_id     bigint;
  v_at     timestamptz;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  if char_length(v_body) not between 1 and 1000 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  r := public.meeting_find(p_code);
  if r.id is null or r.ended_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ended');
  end if;

  -- Messages of one meeting are numbered one after another, so no browser
  -- can miss one that was saved a moment late.
  perform 1 from public.meeting_rooms m where m.id = r.id for no key update;

  update public.meeting_participants x
     set chat_count  = case when x.chat_minute < now() - interval '1 minute' then 1 else x.chat_count + 1 end,
         chat_minute = case when x.chat_minute < now() - interval '1 minute' then now() else x.chat_minute end
   where x.room_id = r.id and x.user_id = v_me and x.status = 'admitted' and x.conn = p_conn
  returning x.chat_count into v_count;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_inside');
  end if;
  if v_count > 20 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  insert into public.meeting_messages (room_id, sender_id, body) values (r.id, v_me, v_body)
  returning id, created_at into v_id, v_at;

  perform public.meeting_nudge(public.meeting_present(r.id, v_me));
  return jsonb_build_object('ok', true, 'id', v_id, 'at', v_at);
end;
$$;

-- Reports another participant to Mokify. Both must have been inside the
-- meeting. At most 10 reports an hour per student.
create function public.meeting_report(p_code text, p_user uuid, p_reason text, p_details text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  r       public.meeting_rooms;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  if p_user is null or p_user = v_me
     or coalesce(p_reason, '') not in ('bullying', 'inappropriate', 'stranger', 'other') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  r := public.meeting_find(p_code);
  if r.id is null or (
       select count(*) from public.meeting_participants x
        where x.room_id = r.id and x.user_id in (v_me, p_user) and x.first_admitted_at is not null
     ) <> 2 then
    return jsonb_build_object('ok', false, 'error', 'not_inside');
  end if;
  if not public.meeting_allow(v_me, 'report', interval '1 hour', 10) then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  insert into public.meeting_reports (room_id, room_code, reporter_id, reported_id, reason, details, present)
  values (r.id, r.code, v_me, p_user, p_reason, left(btrim(coalesce(p_details, ''), E' \t\r\n'), 1000),
          public.meeting_present(r.id));
  return jsonb_build_object('ok', true);
end;
$$;

-- Asked by the website's server (functions/api/ice.js) before it hands a
-- student the relay servers their call goes through: is this student inside
-- this meeting right now? At most 40 times an hour per student.
create function public.meeting_relay_ticket(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  r       public.meeting_rooms;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  r := public.meeting_find(p_code);
  if r.id is null or r.ended_at is not null or not exists (
       select 1 from public.meeting_participants x
        where x.room_id = r.id and x.user_id = v_me and x.status = 'admitted'
     ) then
    return jsonb_build_object('ok', false, 'error', 'not_inside');
  end if;
  if not public.meeting_allow(v_me, 'relay', interval '1 hour', 40) then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Supabase lets the website's key call every new function unless told
-- otherwise, so each one is closed first and then opened to signed-in
-- students only.
revoke all on function public.meeting_create(text)                              from public, anon, authenticated;
revoke all on function public.meeting_mine()                                    from public, anon, authenticated;
revoke all on function public.meeting_info(text)                                from public, anon, authenticated;
revoke all on function public.meeting_join(text, uuid)                          from public, anon, authenticated;
revoke all on function public.meeting_sync(text, uuid, bigint[], bigint)        from public, anon, authenticated;
revoke all on function public.meeting_people(text, uuid[])                      from public, anon, authenticated;
revoke all on function public.meeting_signal(text, uuid, jsonb)                 from public, anon, authenticated;
revoke all on function public.meeting_decide(text, uuid, boolean)               from public, anon, authenticated;
revoke all on function public.meeting_remove(text, uuid)                        from public, anon, authenticated;
revoke all on function public.meeting_lock(text, boolean)                       from public, anon, authenticated;
revoke all on function public.meeting_end(text)                                 from public, anon, authenticated;
revoke all on function public.meeting_leave(text, uuid)                         from public, anon, authenticated;
revoke all on function public.meeting_say(text, uuid, text)                     from public, anon, authenticated;
revoke all on function public.meeting_report(text, uuid, text, text)            from public, anon, authenticated;
revoke all on function public.meeting_relay_ticket(text)                        from public, anon, authenticated;

grant execute on function public.meeting_create(text)                           to authenticated;
grant execute on function public.meeting_mine()                                 to authenticated;
grant execute on function public.meeting_info(text)                             to authenticated;
grant execute on function public.meeting_join(text, uuid)                       to authenticated;
grant execute on function public.meeting_sync(text, uuid, bigint[], bigint)     to authenticated;
grant execute on function public.meeting_people(text, uuid[])                   to authenticated;
grant execute on function public.meeting_signal(text, uuid, jsonb)              to authenticated;
grant execute on function public.meeting_decide(text, uuid, boolean)            to authenticated;
grant execute on function public.meeting_remove(text, uuid)                     to authenticated;
grant execute on function public.meeting_lock(text, boolean)                    to authenticated;
grant execute on function public.meeting_end(text)                              to authenticated;
grant execute on function public.meeting_leave(text, uuid)                      to authenticated;
grant execute on function public.meeting_say(text, uuid, text)                  to authenticated;
grant execute on function public.meeting_report(text, uuid, text, text)         to authenticated;
grant execute on function public.meeting_relay_ticket(text)                     to authenticated;

-- ---------------------------------------------------------------------------
-- Supabase Realtime: each student may listen to their own "check for news"
-- channel (meeting:<their id>) and to nothing else. Nobody may send into
-- these channels; only the functions above do, through the database.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      create policy "Students hear their own meeting nudges" on realtime.messages
        for select to authenticated
        using (
          realtime.messages.extension = 'broadcast'
          and realtime.topic() = 'meeting:' || (select auth.uid())::text
        )
    $policy$;
  end if;
end;
$$;
