-- Points 50 / 10, and social hours with a public check. Run once, after
-- 2026-11-22-lesson-length-points.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * A finished lesson now gives the teacher 50 points and the student 10,
--   whatever its length. (Points already given stay as they were.)
-- * The teacher of a finished lesson also gets 0.5 social hours (30
--   minutes). Each lesson's social hours have their own certificate code;
--   the website shows it as a QR code and a link to patvirtinimas.html,
--   where anyone (also without logging in) can check that it is real: whose
--   it is, their school, the day and length of the lesson, and the hours.
--   The code is 20 random characters, so certificates can't be guessed.
-- * Teachers of lessons finished before this update get their social hours
--   too (the end of this file).

-- ---------------------------------------------------------------------------
-- Points
-- ---------------------------------------------------------------------------

create or replace function public.lesson_points(p_minutes int, p_teacher boolean)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when p_teacher then 50 else 10 end;
$$;

-- ---------------------------------------------------------------------------
-- Social hours
-- ---------------------------------------------------------------------------

create table public.social_hours (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references public.profiles (id) on delete cascade,
  lesson_id     uuid unique references public.lessons (id) on delete set null,
  minutes       int not null default 30 check (minutes > 0),
  -- When the lesson took place and how long it was, kept for the certificate.
  lesson_at     timestamptz not null,
  lesson_minutes int not null,
  code          text not null unique check (code ~ '^[a-z2-9]{20}$'),
  created_at    timestamptz not null default now()
);

create index social_hours_teacher on public.social_hours (teacher_id);

alter table public.social_hours enable row level security;
revoke all on public.social_hours from anon, authenticated;

-- 20 random characters without 0/o/1/i/l.
create function public.new_hours_code()
returns text
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v text := '';
  b int;
begin
  while length(v) < 20 loop
    b := get_byte(extensions.gen_random_bytes(1), 0);
    -- 248 = 8 * 31: higher bytes are dropped so every character is equally likely.
    if b < 248 then
      v := v || substr(alphabet, b % 31 + 1, 1);
    end if;
  end loop;
  return v;
end;
$$;

revoke all on function public.new_hours_code() from public, anon, authenticated;

-- Gives the teacher of a finished lesson their social hours (once).
create function public.lesson_give_hours(p_lesson uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l  public.lessons;
begin
  select * into l from public.lessons x where x.id = p_lesson;
  if l.id is null or l.finished is not true then
    return;
  end if;
  loop
    begin
      insert into public.social_hours (teacher_id, lesson_id, minutes, lesson_at, lesson_minutes, code)
      values (l.teacher_id, l.id, 30, coalesce(l.began_at, l.starts_at, l.created_at), l.duration_minutes, public.new_hours_code())
      on conflict (lesson_id) do nothing;
      exit;
    exception when unique_violation then
      -- The same code twice (practically never): try another.
    end;
  end loop;
end;
$$;

revoke all on function public.lesson_give_hours(uuid) from public, anon, authenticated;

-- Same as before, and: a finished lesson also gives social hours.
create or replace function public.lesson_judge(p_lesson uuid)
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

  select count(*) = 2, min(least(p.last_seen_at, coalesce(r.ended_at, p.last_seen_at)))
    into v_both, v_stayed
    from public.meeting_participants p
   where p.room_id = l.room_id and p.user_id in (l.teacher_id, l.student_id)
     and p.first_admitted_at is not null;

  update public.lessons x
     set judged_at = now(),
         finished = not l.ended_late and coalesce(v_both, false) and v_end is not null
                    and v_stayed >= v_end - interval '5 minutes 30 seconds'
   where x.id = l.id
   returning * into l;

  if l.finished then
    insert into public.points (user_id, lesson_id, reason, amount)
    values (l.teacher_id, l.id, 'lesson_teacher', public.lesson_points(l.duration_minutes, true)),
           (l.student_id, l.id, 'lesson_student', public.lesson_points(l.duration_minutes, false))
    on conflict (user_id, lesson_id) do nothing;
    perform public.lesson_give_hours(l.id);
  end if;
end;
$$;

-- The public check of a certificate (patvirtinimas.html), for anyone with
-- its code: { ok, name, school, lesson_at, lesson_minutes, minutes, issued_at }
-- or { ok: false }.
create function public.verify_social_hours(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
             'ok', true, 'name', p.full_name, 'school', s.name,
             'lesson_at', h.lesson_at, 'lesson_minutes', h.lesson_minutes,
             'minutes', h.minutes, 'issued_at', h.created_at)
      from public.social_hours h
      join public.profiles p on p.id = h.teacher_id
      join public.schools s on s.id = p.school_id
     where h.code = lower(btrim(coalesce(p_code, '')))
  ), jsonb_build_object('ok', false));
$$;

revoke all on function public.verify_social_hours(text) from public;
grant execute on function public.verify_social_hours(text) to anon, authenticated;

-- The signed-in student's social hours: { ok, minutes, items: [...] },
-- newest first. Lessons of the last week that ended are judged first.
create function public.my_social_hours()
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
    where v_me = l.teacher_id and l.status = 'accepted' and l.judged_at is null
      and coalesce(l.starts_at, l.created_at) > now() - interval '7 days';
  return jsonb_build_object(
    'ok', true,
    'minutes', (select coalesce(sum(h.minutes), 0) from public.social_hours h where h.teacher_id = v_me),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'code', h.code, 'minutes', h.minutes, 'lesson_at', h.lesson_at,
               'lesson_minutes', h.lesson_minutes, 'issued_at', h.created_at
             ) order by h.lesson_at desc), '[]'::jsonb)
        from public.social_hours h where h.teacher_id = v_me
    )
  );
end;
$$;

revoke all on function public.my_social_hours() from public, anon, authenticated;
grant execute on function public.my_social_hours() to authenticated;

-- Same as before, and for a lesson that is over: the caller's points total,
-- and (for its teacher) the social hours and their certificate code.
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
  v_over     jsonb;
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
    if now() <= public.lesson_ends_at(l) + interval '5 minutes' then
      v_code := public.lesson_make_room(l.id);
    end if;
  else
    select m.code into v_code from public.meeting_rooms m where m.id = l.room_id;
  end if;

  if v_code is not null then
    r := public.meeting_find(v_code);
  end if;
  if v_code is null or r.id is null or r.ended_at is not null then
    select * into l from public.lessons x where x.id = p_lesson;
    select jsonb_build_object(
             'ok', false, 'error', 'over', 'finished', coalesce(l.finished, false),
             'i_teach', l.teacher_id = v_me, 'partner', v_partner,
             'duration', l.duration_minutes,
             'points', (select p.amount from public.points p where p.lesson_id = l.id and p.user_id = v_me),
             'points_total', (select coalesce(sum(p.amount), 0) from public.points p where p.user_id = v_me),
             'hours', (select jsonb_build_object('minutes', h.minutes, 'code', h.code,
                                                 'total', (select sum(x.minutes) from public.social_hours x where x.teacher_id = v_me))
                         from public.social_hours h where h.lesson_id = l.id and h.teacher_id = v_me))
      into v_over;
    return v_over;
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

-- ---------------------------------------------------------------------------
-- Lessons finished before this update: their teachers get social hours too.
-- ---------------------------------------------------------------------------

select public.lesson_give_hours(l.id)
  from public.lessons l
 where l.finished is true
   and not exists (select 1 from public.social_hours h where h.lesson_id = l.id);
