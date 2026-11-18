-- Admins add or take away a user's points (vartotojai.html). Run once,
-- after 2026-11-23-rewards.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * A change is its own row in public.points (reason 'admin', positive or
--   negative), with who made it and an optional note, so totals (and a
--   future leaderboard) include it and nothing is overwritten.
-- * A user's total can't go below 0.
-- * Every change is also written to public.admin_log.

alter table public.points drop constraint if exists points_reason_check;
alter table public.points add constraint points_reason_check
  check (reason in ('lesson_teacher', 'lesson_student', 'admin'));

alter table public.points drop constraint if exists points_amount_check;
alter table public.points add constraint points_amount_check check (amount <> 0);

alter table public.points
  add column note      text check (char_length(note) <= 200),
  add column added_by  uuid references public.profiles (id) on delete set null;

alter table public.admin_log drop constraint if exists admin_log_action_check;
alter table public.admin_log add constraint admin_log_action_check check (
  action in ('update_user', 'delete_user', 'update_school', 'extend_school', 'delete_school', 'delete_codes', 'adjust_points')
);

-- Adds p_amount points to a user (negative takes them away; 1-100000 either
-- way). { ok, total } or { ok: false, error: 'below_zero', total }.
create function public.admin_adjust_points(p_user uuid, p_amount int, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_name   text;
  v_total  int;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;
  if char_length(v_note) > 200 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;
  select username into v_name from public.profiles where id = p_user for update;
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(sum(amount), 0) into v_total from public.points where user_id = p_user;
  if v_total + p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'below_zero', 'total', v_total);
  end if;

  insert into public.points (user_id, reason, amount, note, added_by)
  values (p_user, 'admin', p_amount, v_note, v_me);

  insert into public.admin_log (admin_id, action, target_id, target_username, details)
  values (v_me, 'adjust_points', p_user, v_name,
          jsonb_build_object('amount', p_amount, 'note', v_note, 'total_after', v_total + p_amount));

  return jsonb_build_object('ok', true, 'total', v_total + p_amount);
end;
$$;

revoke all on function public.admin_adjust_points(uuid, int, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_points(uuid, int, text) to authenticated;

-- Same as before, and the user's points and social hours.
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
    'admin', exists (select 1 from public.admins a where a.user_id = v_p.id),
    'reviewer', exists (select 1 from public.reviewers r where r.user_id = v_p.id),
    'me', v_p.id = v_me
  ));
end;
$$;
