-- Managing schools on the website (mokyklos.html): renaming, changing the
-- contact email, setting or extending the subscription, and deleting a
-- school. Run once, after 2026-11-20-admin-users.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * Only admins (public.admins) can use it.
-- * The subscription's last day can be set to any day from 2020 to ten
--   years ahead (a day in the past ends the subscription), or extended by a
--   number of months: from the current last day, or from today if it has
--   already ended.
-- * A school can only be deleted once it has no students (delete them on
--   vartotojai.html first); its registration codes go with it.
-- * Every change is written to public.admin_log.

alter table public.admin_log drop constraint if exists admin_log_action_check;
alter table public.admin_log add constraint admin_log_action_check check (
  action in ('update_user', 'delete_user', 'update_school', 'extend_school', 'delete_school')
);

-- Same answer as before, plus each school's number of students and when it
-- was added (the codes page uses the same list).
-- { ok, today, schools: [{ id, name, contact_email, subscription_ends, codes, used, students, created_at }] }
create or replace function public.admin_schools()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.admins where user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'today', public.today_lt(),
    'schools', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'contact_email', s.contact_email,
               'subscription_ends', s.subscription_ends, 'created_at', s.created_at,
               'codes', coalesce(c.codes, 0), 'used', coalesce(c.used, 0),
               'students', (select count(*) from public.profiles p where p.school_id = s.id)
             ) order by lower(s.name)), '[]'::jsonb)
        from public.schools s
        left join (
          select a.school_id,
                 count(*)::int as codes,
                 count(*) filter (where u.email_confirmed_at is not null)::int as used
            from public.access_codes a
            left join auth.users u on u.id = a.redeemed_by
           group by a.school_id
        ) c on c.school_id = s.id
    )
  );
end;
$$;

-- The school's fields as the page shows them, after a change.
create function public.admin_school_row(p_school uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'contact_email', s.contact_email,
    'subscription_ends', s.subscription_ends, 'created_at', s.created_at)
    from public.schools s where s.id = p_school;
$$;

revoke all on function public.admin_school_row(uuid) from public, anon, authenticated;

-- The same name in other letter case counts as taken (as in admin_create_school).
create function public.school_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(translate(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 'ĄČĘĖĮŠŲŪŽ', 'ąčęėįšųūž'));
$$;

revoke all on function public.school_name_key(text) from public, anon, authenticated;

-- Changes a school's name, contact email (optional) and the subscription's
-- last day. { ok, school }
create function public.admin_update_school(p_school uuid, p_name text, p_contact_email text, p_subscription_ends date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_old    public.schools;
  v_name   text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_email  text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into v_old from public.schools where id = p_school for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if char_length(v_name) not between 2 and 200 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;
  if p_subscription_ends is null
     or p_subscription_ends < date '2020-01-01'
     or p_subscription_ends > public.today_lt() + interval '10 years' then
    return jsonb_build_object('ok', false, 'error', 'bad_date');
  end if;
  if exists (select 1 from public.schools
              where id <> p_school and public.school_name_key(name) = public.school_name_key(v_name)) then
    return jsonb_build_object('ok', false, 'error', 'exists');
  end if;

  update public.schools
     set name = v_name, contact_email = v_email, subscription_ends = p_subscription_ends
   where id = p_school;

  insert into public.admin_log (admin_id, action, target_id, target_username, details)
  values (v_me, 'update_school', p_school, v_name, jsonb_build_object(
    'before', jsonb_build_object('name', v_old.name, 'contact_email', v_old.contact_email, 'subscription_ends', v_old.subscription_ends),
    'after', jsonb_build_object('name', v_name, 'contact_email', v_email, 'subscription_ends', p_subscription_ends)));

  return jsonb_build_object('ok', true, 'school', public.admin_school_row(p_school));
end;
$$;

revoke all on function public.admin_update_school(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.admin_update_school(uuid, text, text, date) to authenticated;

-- Extends the subscription by p_months (1-60): from its last day, or from
-- today if it has already ended. { ok, school }
create function public.admin_extend_school(p_school uuid, p_months int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_old   public.schools;
  v_new   date;
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_months is null or p_months not between 1 and 60 then
    return jsonb_build_object('ok', false, 'error', 'bad_months');
  end if;
  select * into v_old from public.schools where id = p_school for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_new := (greatest(v_old.subscription_ends, public.today_lt()) + make_interval(months => p_months))::date;
  if v_new > public.today_lt() + interval '10 years' then
    return jsonb_build_object('ok', false, 'error', 'bad_date');
  end if;

  update public.schools set subscription_ends = v_new where id = p_school;

  insert into public.admin_log (admin_id, action, target_id, target_username, details)
  values (v_me, 'extend_school', p_school, v_old.name, jsonb_build_object(
    'months', p_months, 'before', v_old.subscription_ends, 'after', v_new));

  return jsonb_build_object('ok', true, 'school', public.admin_school_row(p_school));
end;
$$;

revoke all on function public.admin_extend_school(uuid, int) from public, anon, authenticated;
grant execute on function public.admin_extend_school(uuid, int) to authenticated;

-- Deletes a school that has no students, with its registration codes.
-- { ok } or { ok: false, error: 'has_students', students: n }
create function public.admin_delete_school(p_school uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me        uuid := auth.uid();
  v_school    public.schools;
  v_students  int;
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into v_school from public.schools where id = p_school for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select count(*) into v_students from public.profiles where school_id = p_school;
  if v_students > 0 then
    return jsonb_build_object('ok', false, 'error', 'has_students', 'students', v_students);
  end if;

  insert into public.admin_log (admin_id, action, target_id, target_username, details)
  values (v_me, 'delete_school', p_school, v_school.name, jsonb_build_object(
    'contact_email', v_school.contact_email, 'subscription_ends', v_school.subscription_ends,
    'codes', (select count(*) from public.access_codes where school_id = p_school)));

  delete from public.schools where id = p_school;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_delete_school(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_school(uuid) to authenticated;

-- A quick check: the admins who can use the page.
select p.username, p.full_name from public.admins a join public.profiles p on p.id = a.user_id;
