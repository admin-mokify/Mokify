-- The leaderboard (lyderiai.html): everyone with points, most first. Open to
-- anyone, also without logging in. Run once, after 2026-11-26-titles.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * Only users with more than 0 points are on it, so it never lists the
--   whole school roll.
-- * Equal points share a place (1, 2, 2, 4).
-- * A profile from the leaderboard shows only what a student would show to
--   anyone: name, @username, picture, points, place, titles, finished
--   lessons, and for teachers what they teach and their rating. School,
--   class and "about me" are added only for logged-in visitors. Email,
--   documents, comments and anything else never.

-- Everyone with points and their place (helper, not callable from the site).
create function public.leaderboard_rows()
returns table (user_id uuid, points bigint, place bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select t.user_id, t.total, rank() over (order by t.total desc)
    from (select p.user_id, sum(p.amount) as total
            from public.points p
           group by p.user_id) t
   where t.total > 0;
$$;

revoke all on function public.leaderboard_rows() from public, anon, authenticated;

-- One page of the leaderboard, optionally only names / usernames containing
-- p_query (places stay the real ones). p_limit 1-100.
-- { ok, total, items: [{ place, id, name, username, avatar, points, teacher }],
--   me: { place, points } | null (logged in and on the board) }
create function public.leaderboard(p_query text default null, p_offset int default 0, p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q       text := lower(translate(btrim(coalesce(p_query, '')), 'ĄČĘĖĮŠŲŪŽ', 'ąčęėįšųūž'));
  v_offset  int := greatest(coalesce(p_offset, 0), 0);
  v_limit   int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_me      uuid := auth.uid();
begin
  if char_length(v_q) > 50 then
    return jsonb_build_object('ok', false, 'error', 'bad_query');
  end if;
  v_q := ltrim(v_q, '@');

  return (
    with board as (
      select r.user_id, r.points, r.place, pr.full_name, pr.username, pr.avatar,
             exists (select 1 from public.teacher_profiles t where t.id = r.user_id) as teacher
        from public.leaderboard_rows() r
        join public.profiles pr on pr.id = r.user_id
    ),
    hits as (
      select * from board
       where v_q = ''
          or position(v_q in lower(translate(full_name, 'ĄČĘĖĮŠŲŪŽ', 'ąčęėįšųūž'))) > 0
          or position(v_q in lower(username)) > 0
    ),
    page as (
      select * from hits
       order by place, lower(full_name), user_id
      offset v_offset limit v_limit
    )
    select jsonb_build_object(
      'ok', true,
      'total', (select count(*) from hits),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
                         'place', place, 'id', user_id, 'name', full_name, 'username', username,
                         'avatar', avatar, 'points', points, 'teacher', teacher)
                       order by place, lower(full_name), user_id), '[]'::jsonb)
                  from page),
      'me', case when v_me is null then null else
              (select jsonb_build_object('place', b.place, 'points', b.points) from board b where b.user_id = v_me)
            end)
  );
end;
$$;

revoke all on function public.leaderboard(text, int, int) from public, anon, authenticated;
grant execute on function public.leaderboard(text, int, int) to anon, authenticated;

-- A leaderboard profile. Only for users on the leaderboard.
-- { ok, user: { ... } } or { ok: false, error: 'not_found' }
create function public.leaderboard_profile(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row  record;
  v_p    public.profiles;
  v_t    public.teacher_profiles;
  v_out  jsonb;
begin
  select * into v_row from public.leaderboard_rows() r where r.user_id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_p from public.profiles where id = p_user;
  select * into v_t from public.teacher_profiles where id = p_user;

  v_out := jsonb_build_object(
    'id', v_p.id, 'name', v_p.full_name, 'username', v_p.username, 'avatar', v_p.avatar,
    'points', v_row.points, 'place', v_row.place,
    'titles', public.titles_of(p_user),
    'lessons_taught', (select count(*) from public.lessons l where l.teacher_id = p_user and l.finished),
    'lessons_learned', (select count(*) from public.lessons l where l.student_id = p_user and l.finished),
    'teacher', case when v_t.id is null then null else jsonb_build_object(
                 'subjects', v_t.subjects, 'levels', v_t.levels,
                 'rating', (select case when count(*) = 0 then null else
                                     jsonb_build_object('average', round(avg(x.stars), 1), 'count', count(*)) end
                              from public.lesson_ratings x
                             where x.ratee_id = p_user and x.kind = 'teacher'))
               end);

  -- Logged-in visitors (other students) also see school, class and bio.
  if auth.uid() is not null then
    v_out := v_out || jsonb_build_object(
      'school', (select s.name from public.schools s where s.id = v_p.school_id),
      'grade', v_p.grade,
      'bio', v_p.bio);
  end if;

  return jsonb_build_object('ok', true, 'user', v_out);
end;
$$;

revoke all on function public.leaderboard_profile(uuid) from public, anon, authenticated;
grant execute on function public.leaderboard_profile(uuid) to anon, authenticated;
