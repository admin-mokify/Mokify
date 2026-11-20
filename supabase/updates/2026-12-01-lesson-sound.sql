-- Was anyone actually talking during a lesson? Run once, after
-- 2026-11-30-lesson-invite-fix.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * During a lesson each student's own browser measures whether its
--   microphone picks up any sound (also when the site shows it as on, so an
--   unplugged or wrong microphone counts as silence; muted counts as
--   silence too). Every 30 seconds it sends only yes or no. Nothing that is
--   said is recorded or sent. The camera is not checked.
-- * public.lesson_sound keeps one yes/no per student per lesson minute. The
--   minute is worked out by the database from its own clock, so a page
--   can't fill in minutes that haven't happened.
-- * A lesson only counts (points, social hours) if there was sound in at
--   least half of its minutes, and each of the two had sound in at least
--   10% of them (at least 2 minutes). A lesson that would otherwise have
--   counted but was too quiet gets lessons.quiet = true, so its end screen
--   can say why.

create table public.lesson_sound (
  lesson_id  uuid not null references public.lessons (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  minute     int not null check (minute between 0 and 300),
  sound      boolean not null,
  primary key (lesson_id, user_id, minute)
);

alter table public.lesson_sound enable row level security;
revoke all on public.lesson_sound from anon, authenticated;

alter table public.lessons add column quiet boolean;

-- One report from a student in a lesson's call: was there sound (p_sound)
-- since the last one. { ok, minute } / { ok: true, counted: false } outside
-- the lesson's time / { ok: false, error }.
create function public.lesson_sound_report(p_lesson uuid, p_sound boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  l      public.lessons;
  r      public.meeting_rooms;
  v_min  int;
begin
  select * into l from public.lessons x
   where x.id = p_lesson and v_me in (x.teacher_id, x.student_id);
  if l.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if l.status <> 'accepted' or p_sound is null then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;
  -- Starts the lesson's clock once both are in (and keeps the call on time).
  perform public.lesson_tick(l.id);
  select * into l from public.lessons x where x.id = p_lesson;
  if l.began_at is null then
    return jsonb_build_object('ok', false, 'error', 'not_started');
  end if;
  select * into r from public.meeting_rooms m where m.id = l.room_id;
  if r.id is null or r.ended_at is not null then
    return jsonb_build_object('ok', false, 'error', 'over');
  end if;
  if not exists (select 1 from public.meeting_participants p
                  where p.room_id = r.id and p.user_id = v_me and p.status = 'admitted') then
    return jsonb_build_object('ok', false, 'error', 'not_in_call');
  end if;

  v_min := floor(extract(epoch from (now() - l.began_at)) / 60)::int;
  if v_min < 0 or v_min >= l.duration_minutes then
    return jsonb_build_object('ok', true, 'counted', false);
  end if;
  -- Two reports land in most minutes; any sound in the minute counts.
  insert into public.lesson_sound (lesson_id, user_id, minute, sound)
  values (l.id, v_me, v_min, p_sound)
  on conflict (lesson_id, user_id, minute)
    do update set sound = public.lesson_sound.sound or excluded.sound;
  return jsonb_build_object('ok', true, 'minute', v_min);
end;
$$;

revoke all on function public.lesson_sound_report(uuid, boolean) from public, anon, authenticated;
grant execute on function public.lesson_sound_report(uuid, boolean) to authenticated;

-- Whether a lesson had enough sound (helper): sound in at least half of its
-- minutes, and each of the two in at least 10% of them (at least 2).
create function public.lesson_had_sound(l public.lessons)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(distinct s.minute) from public.lesson_sound s
           where s.lesson_id = l.id and s.sound) >= ceil(l.duration_minutes * 0.5)
     and (select count(*) from public.lesson_sound s
           where s.lesson_id = l.id and s.user_id = l.teacher_id and s.sound)
         >= greatest(2, ceil(l.duration_minutes * 0.1))
     and (select count(*) from public.lesson_sound s
           where s.lesson_id = l.id and s.user_id = l.student_id and s.sound)
         >= greatest(2, ceil(l.duration_minutes * 0.1));
$$;

revoke all on function public.lesson_had_sound(public.lessons) from public, anon, authenticated;

-- Same as before (2026-11-23-rewards.sql), and the lesson must have had
-- enough sound.
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
  v_on_time boolean;
  v_sound   boolean;
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

  v_on_time := not l.ended_late and coalesce(v_both, false) and v_end is not null
               and v_stayed >= v_end - interval '5 minutes 30 seconds';
  v_sound := public.lesson_had_sound(l);

  update public.lessons x
     set judged_at = now(),
         finished = v_on_time and v_sound,
         quiet = v_on_time and not v_sound
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

-- For a lesson's end screen: was it not counted because it was too quiet?
-- { ok, quiet }
create function public.lesson_quiet(p_lesson uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('ok', true, 'quiet', coalesce(l.quiet, false))
       from public.lessons l
      where l.id = p_lesson and auth.uid() in (l.teacher_id, l.student_id)),
    jsonb_build_object('ok', false, 'error', 'not_found'));
$$;

revoke all on function public.lesson_quiet(uuid) from public, anon, authenticated;
grant execute on function public.lesson_quiet(uuid) to authenticated;
