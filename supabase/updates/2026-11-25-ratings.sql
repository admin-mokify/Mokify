-- Ratings after a lesson. Run once, after 2026-11-24-admin-points.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * After a finished lesson, the student rates the teacher (1-5 stars) and
--   the teacher rates how attentive and interested the student was (1-5
--   stars). Each may add a comment. A rating can be given or changed for 14
--   days after the lesson.
-- * A teacher's average (from students) is shown to students in the teacher
--   list and on the teacher's profile. A student's rating (from teachers)
--   and all comments are seen only by Mokify's admins (vartotojai.html).
-- * The result at the bottom lists everyone with admin or reviewer access;
--   it should be @boomroob only.

create table public.lesson_ratings (
  lesson_id   uuid not null references public.lessons (id) on delete cascade,
  rater_id    uuid not null references public.profiles (id) on delete cascade,
  ratee_id    uuid not null references public.profiles (id) on delete cascade,
  -- 'teacher': the student rated the teacher; 'student': the teacher rated
  -- the student's attention and interest.
  kind        text not null check (kind in ('teacher', 'student')),
  stars       smallint not null check (stars between 1 and 5),
  comment     text check (char_length(comment) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (lesson_id, rater_id)
);

create index lesson_ratings_ratee on public.lesson_ratings (ratee_id, kind);

alter table public.lesson_ratings enable row level security;
revoke all on public.lesson_ratings from anon, authenticated;

-- Whether the caller may (still) rate this lesson: it was finished, they
-- were in it, and it ended at most 14 days ago.
create function public.lesson_can_rate(l public.lessons, p_user uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select l.finished is true
     and p_user in (l.teacher_id, l.student_id)
     and now() <= public.lesson_ends_at(l) + interval '14 days';
$$;

revoke all on function public.lesson_can_rate(public.lessons, uuid) from public, anon, authenticated;

-- Gives or changes the caller's rating of a finished lesson.
-- { ok, stars } or { ok: false, error }.
create function public.lesson_rate(p_lesson uuid, p_stars int, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  l          public.lessons;
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'signed_out');
  end if;
  select * into l from public.lessons x where x.id = p_lesson and v_me in (x.teacher_id, x.student_id);
  if l.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform public.lesson_tick(l.id);
  select * into l from public.lessons x where x.id = p_lesson;
  if not public.lesson_can_rate(l, v_me) then
    return jsonb_build_object('ok', false, 'error', case when l.finished is true then 'too_late' else 'not_finished' end);
  end if;
  if p_stars is null or p_stars not between 1 and 5 then
    return jsonb_build_object('ok', false, 'error', 'bad_stars');
  end if;
  if char_length(v_comment) > 300 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;

  insert into public.lesson_ratings (lesson_id, rater_id, ratee_id, kind, stars, comment)
  values (l.id, v_me,
          case when v_me = l.student_id then l.teacher_id else l.student_id end,
          case when v_me = l.student_id then 'teacher' else 'student' end,
          p_stars, v_comment)
  on conflict (lesson_id, rater_id) do update
     set stars = excluded.stars, comment = excluded.comment, updated_at = now();
  return jsonb_build_object('ok', true, 'stars', p_stars);
end;
$$;

revoke all on function public.lesson_rate(uuid, int, text) from public, anon, authenticated;
grant execute on function public.lesson_rate(uuid, int, text) to authenticated;

-- Teachers' averages from students' ratings, for the given teachers (at most
-- 500): [{ id, average, count }]. Only teachers with a rating are listed.
create function public.teacher_ratings(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null or cardinality(p_ids) > 500 then '[]'::jsonb else (
    select coalesce(jsonb_agg(jsonb_build_object('id', r.ratee_id, 'average', r.average, 'count', r.n)), '[]'::jsonb)
      from (
        select x.ratee_id, round(avg(x.stars), 1) as average, count(*) as n
          from public.lesson_ratings x
         where x.kind = 'teacher' and x.ratee_id = any (p_ids)
         group by x.ratee_id
      ) r
  ) end;
$$;

revoke all on function public.teacher_ratings(uuid[]) from public, anon, authenticated;
grant execute on function public.teacher_ratings(uuid[]) to authenticated;

-- Same as before (2026-11-23-rewards.sql), and for a lesson that is over:
-- whether the caller can rate it, and their rating so far.
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
             'lesson', l.id,
             'i_teach', l.teacher_id = v_me, 'partner', v_partner,
             'duration', l.duration_minutes,
             'points', (select p.amount from public.points p where p.lesson_id = l.id and p.user_id = v_me),
             'points_total', (select coalesce(sum(p.amount), 0) from public.points p where p.user_id = v_me),
             'hours', (select jsonb_build_object('minutes', h.minutes, 'code', h.code,
                                                 'total', (select sum(x.minutes) from public.social_hours x where x.teacher_id = v_me))
                         from public.social_hours h where h.lesson_id = l.id and h.teacher_id = v_me),
             'can_rate', public.lesson_can_rate(l, v_me),
             'my_rating', (select jsonb_build_object('stars', x.stars, 'comment', x.comment)
                             from public.lesson_ratings x where x.lesson_id = l.id and x.rater_id = v_me))
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

-- Same as before (2026-11-22), and for each lesson whether the caller can
-- rate it and has done so.
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
               'can_rate', q.can_rate,
               'rated', q.rated,
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
                 public.lesson_can_rate(l, v_me) as can_rate,
                 exists (select 1 from public.lesson_ratings x where x.lesson_id = l.id and x.rater_id = v_me) as rated,
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

-- Same as before (2026-11-24), and the user's ratings: as a teacher (from
-- students), as a student (from teachers), and the latest ones with comments.
create or replace function public.admin_user(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_p   public.profiles;
  v_u   auth.users;
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into v_p from public.profiles where id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_u from auth.users where id = p_user;

  return jsonb_build_object('ok', true, 'user', jsonb_build_object(
    'id', v_p.id, 'full_name', v_p.full_name, 'username', v_p.username, 'email', v_p.email,
    'grade', v_p.grade, 'bio', v_p.bio, 'avatar', v_p.avatar, 'created_at', v_p.created_at,
    'last_sign_in_at', v_u.last_sign_in_at,
    'school', (select jsonb_build_object('name', s.name, 'subscription_ends', s.subscription_ends)
                 from public.schools s where s.id = v_p.school_id),
    'teacher', (select jsonb_build_object('subjects', t.subjects, 'levels', t.levels)
                  from public.teacher_profiles t where t.id = v_p.id),
    'documents', (select jsonb_build_object(
                           'pending', count(*) filter (where d.status = 'pending'),
                           'verified', count(*) filter (where d.status = 'verified'),
                           'rejected', count(*) filter (where d.status = 'rejected'))
                    from public.teacher_documents d where d.teacher_id = v_p.id),
    'messages_sent', (select count(*) from public.messages m where m.sender_id = v_p.id),
    'lessons', (select count(*) from public.lessons l where v_p.id in (l.teacher_id, l.student_id)),
    'points', (select coalesce(sum(x.amount), 0) from public.points x where x.user_id = v_p.id),
    'social_minutes', (select coalesce(sum(h.minutes), 0) from public.social_hours h where h.teacher_id = v_p.id),
    'rating_teacher', (select jsonb_build_object('average', round(avg(r.stars), 1), 'count', count(*))
                         from public.lesson_ratings r where r.ratee_id = v_p.id and r.kind = 'teacher'),
    'rating_student', (select jsonb_build_object('average', round(avg(r.stars), 1), 'count', count(*))
                         from public.lesson_ratings r where r.ratee_id = v_p.id and r.kind = 'student'),
    'ratings', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', q.kind, 'stars', q.stars, 'comment', q.comment, 'at', q.updated_at, 'by', q.username
             ) order by q.updated_at desc), '[]'::jsonb)
        from (
          select r.kind, r.stars, r.comment, r.updated_at, p.username
            from public.lesson_ratings r
            left join public.profiles p on p.id = r.rater_id
           where r.ratee_id = v_p.id
           order by r.updated_at desc
           limit 20
        ) q
    ),
    'admin', exists (select 1 from public.admins a where a.user_id = v_p.id),
    'reviewer', exists (select 1 from public.reviewers r where r.user_id = v_p.id),
    'me', v_p.id = v_me
  ));
end;
$$;

-- Who has admin or reviewer access. It should be @boomroob ("Admin") only;
-- anyone else can be removed with the lines at the top of
-- 2026-11-19-admin-codes.sql and 2026-11-18-document-review.sql.
select 'admin' as access, p.username, p.full_name from public.admins a join public.profiles p on p.id = a.user_id
union all
select 'reviewer', p.username, p.full_name from public.reviewers r join public.profiles p on p.id = r.user_id
order by 1, 2;
