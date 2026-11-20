-- Private and public meetings.
--
-- Private (the default, and what every meeting so far was): anyone who wants
-- to come in asks, and the organizer lets them in or not.
-- Public: anyone with the link or code walks straight in, unless the
-- organizer locked the meeting. Blocks, removals and the size limit still
-- apply. Lessons are not affected.
--
-- Run once in the Supabase SQL Editor.

alter table public.meeting_rooms
  add column if not exists public boolean not null default false;

-- meeting_create gets a second, optional parameter. The old one-parameter
-- version is replaced so there is only one.
drop function if exists public.meeting_create(text);

create or replace function public.meeting_create(p_title text default '', p_public boolean default false)
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
    insert into public.meeting_rooms (code, owner_id, title, public)
    values (v_code, v_me, v_title, coalesce(p_public, false))
    on conflict do nothing;
    exit when found;
  end loop;
  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

revoke all on function public.meeting_create(text, boolean) from public, anon, authenticated;
grant execute on function public.meeting_create(text, boolean) to authenticated;

-- The organizer's list says which kind each meeting is.
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
             'public', m.public,
             'created_at', m.created_at,
             'expires_at', m.expires_at,
             'present', cardinality(public.meeting_present(m.id))
           ) order by m.created_at desc), '[]'::jsonb)
      from public.meeting_rooms m
     where m.owner_id = v_me and m.kind = 'open' and m.ended_at is null and m.expires_at > now()
  ));
end;
$$;

-- Same as before, plus 'public', so the page knows whether to say
-- "Prisijungti" or "Prašyti prisijungti".
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
    'public', r.kind = 'open' and r.public,
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

-- Same as before, except that in a public meeting nobody has to ask.
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

  -- A locked meeting takes nobody new, public or not.
  if r.locked then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;

  -- Public meeting: come straight in while there is room.
  if r.public then
    select s.max_participants into v_max from public.meeting_settings s;
    if cardinality(public.meeting_present(r.id, v_me)) >= v_max then
      return jsonb_build_object('ok', false, 'error', 'full');
    end if;
    insert into public.meeting_participants as x (room_id, user_id, status, conn, seq, first_admitted_at)
    values (r.id, v_me, 'admitted', p_conn, v_seq, now())
    on conflict (room_id, user_id) do update
      set status = 'admitted', conn = excluded.conn, seq = excluded.seq, left_at = null,
          last_seen_at = now(), first_admitted_at = coalesce(x.first_admitted_at, now());
    perform public.meeting_nudge(public.meeting_present(r.id, v_me));
    return jsonb_build_object('ok', true, 'status', 'admitted', 'seq', v_seq, 'owner', r.owner_id);
  end if;

  -- Private meeting: everyone else asks first.
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
