-- "Hide me from the leaderboard" (paskyra.html). Run once, after
-- 2026-11-27-leaderboard.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * A hidden student is left out of the leaderboard, its search and its
--   profiles completely; everyone below moves up a place.
-- * Their points still count and are still shown to them on their account.

alter table public.profiles
  add column leaderboard_hidden boolean not null default false;

-- Same as before, without hidden students.
create or replace function public.leaderboard_rows()
returns table (user_id uuid, points bigint, place bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select t.user_id, t.total, rank() over (order by t.total desc)
    from (select p.user_id, sum(p.amount) as total
            from public.points p
            join public.profiles pr on pr.id = p.user_id
           where not pr.leaderboard_hidden
           group by p.user_id) t
   where t.total > 0;
$$;

revoke all on function public.leaderboard_rows() from public, anon, authenticated;

-- { ok, hidden } for the logged-in student.
create function public.my_leaderboard_hidden()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then jsonb_build_object('ok', false, 'error', 'forbidden')
         else coalesce((select jsonb_build_object('ok', true, 'hidden', p.leaderboard_hidden)
                          from public.profiles p where p.id = auth.uid()),
                       jsonb_build_object('ok', false, 'error', 'not_found')) end;
$$;

revoke all on function public.my_leaderboard_hidden() from public, anon, authenticated;
grant execute on function public.my_leaderboard_hidden() to authenticated;

-- Hides (true) or shows (false) the logged-in student. { ok, hidden }
create function public.set_leaderboard_hidden(p_hidden boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update public.profiles set leaderboard_hidden = coalesce(p_hidden, false) where id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'hidden', coalesce(p_hidden, false));
end;
$$;

revoke all on function public.set_leaderboard_hidden(boolean) from public, anon, authenticated;
grant execute on function public.set_leaderboard_hidden(boolean) to authenticated;
