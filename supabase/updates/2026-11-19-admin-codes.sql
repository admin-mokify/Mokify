-- Creating schools and registration codes on the website (kodai.html)
-- instead of in the Supabase SQL editor. Run once, after
-- 2026-11-18-document-review.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
-- The result at the bottom lists the admins; if it is empty, the account
-- @boomroob didn't exist yet (create it, then run the last section again).
--
-- * Only students listed in public.admins may use it. Nobody can add
--   themselves: the list can only be changed here, in the SQL editor:
--     insert into public.admins (user_id)
--       select id from public.profiles where lower(username) = 'someone';
--     delete from public.admins
--      where user_id = (select id from public.profiles where lower(username) = 'someone');
--   (This is a separate list from public.reviewers: being able to create
--   codes is more than being able to check documents.)
-- * An admin picks a school, or adds a new one (name, contact email,
--   last day of its subscription), and how many codes to create (1-1000 at a
--   time). The codes are shown once, to copy or download.
-- * Every batch is written to public.access_code_batches (who, which school,
--   how many, when), which only Mokify can read.

-- ---------------------------------------------------------------------------
-- Admins and the batch log
-- ---------------------------------------------------------------------------

create table public.admins (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  added_at  timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create table public.access_code_batches (
  id          bigint generated always as identity primary key,
  school_id   uuid not null references public.schools (id) on delete cascade,
  created_by  uuid references public.profiles (id) on delete set null,
  code_count  int not null check (code_count between 1 and 1000),
  created_at  timestamptz not null default now()
);

alter table public.access_code_batches enable row level security;
revoke all on public.access_code_batches from anon, authenticated;

-- Whether the signed-in student is an admin (the account page shows a link
-- to the codes page if so). Answers only about oneself.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- The codes page's data
-- ---------------------------------------------------------------------------

-- Every school, with how many codes it has and how many are taken (by an
-- account whose email is confirmed, as in access_code_status).
-- { ok, today, schools: [{ id, name, contact_email, subscription_ends, codes, used }] }
create function public.admin_schools()
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
               'subscription_ends', s.subscription_ends,
               'codes', coalesce(c.codes, 0), 'used', coalesce(c.used, 0)
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

revoke all on function public.admin_schools() from public, anon, authenticated;
grant execute on function public.admin_schools() to authenticated;

-- Adds a school. p_contact_email is optional. The subscription must run at
-- least until today and at most five years ahead.
-- { ok, school: { id, name, contact_email, subscription_ends, codes, used } }
create function public.admin_create_school(p_name text, p_contact_email text, p_subscription_ends date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_email  text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_id     uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.admins where user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if char_length(v_name) not between 2 and 200 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;
  if p_subscription_ends is null
     or p_subscription_ends < public.today_lt()
     or p_subscription_ends > public.today_lt() + interval '5 years' then
    return jsonb_build_object('ok', false, 'error', 'bad_date');
  end if;
  -- The same name in other letter case counts as taken. (translate() first:
  -- depending on the database's settings, lower() may leave Lithuanian
  -- capitals such as Ž unchanged.)
  if exists (
    select 1 from public.schools
     where lower(translate(name, 'ĄČĘĖĮŠŲŪŽ', 'ąčęėįšųūž')) = lower(translate(v_name, 'ĄČĘĖĮŠŲŪŽ', 'ąčęėįšųūž'))
  ) then
    return jsonb_build_object('ok', false, 'error', 'exists');
  end if;

  insert into public.schools (name, contact_email, subscription_ends)
  values (v_name, v_email, p_subscription_ends)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'school', jsonb_build_object(
    'id', v_id, 'name', v_name, 'contact_email', v_email,
    'subscription_ends', p_subscription_ends, 'codes', 0, 'used', 0));
end;
$$;

revoke all on function public.admin_create_school(text, text, date) from public, anon, authenticated;
grant execute on function public.admin_create_school(text, text, date) to authenticated;

-- Creates p_count (1-1000) codes for a school whose subscription is still
-- running and returns them as students type them (MOK-XXXX-XXXX).
-- { ok, school, codes: [...] }
create function public.admin_generate_codes(p_school uuid, p_count int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_school  public.schools;
  v_codes   jsonb;
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_count is null or p_count not between 1 and 1000 then
    return jsonb_build_object('ok', false, 'error', 'bad_count');
  end if;

  select * into v_school from public.schools where id = p_school;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  -- Codes of a school whose subscription has ended can't be used to sign up.
  if v_school.subscription_ends < public.today_lt() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  select coalesce(jsonb_agg(c.access_code), '[]'::jsonb) into v_codes
    from public.create_access_codes(v_school.id, p_count) c;

  insert into public.access_code_batches (school_id, created_by, code_count)
  values (v_school.id, v_me, p_count);

  return jsonb_build_object('ok', true, 'school', v_school.name, 'codes', v_codes);
end;
$$;

revoke all on function public.admin_generate_codes(uuid, int) from public, anon, authenticated;
grant execute on function public.admin_generate_codes(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- The first admin: @boomroob, shown as "Admin".
-- ---------------------------------------------------------------------------

update public.profiles set full_name = 'Admin' where lower(username) = 'boomroob';

insert into public.admins (user_id)
select id from public.profiles where lower(username) = 'boomroob'
on conflict (user_id) do nothing;

select p.username, p.full_name
  from public.admins a
  join public.profiles p on p.id = a.user_id;
