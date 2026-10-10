-- Mokify schools and students. Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Then run each file in supabase/updates/ once, oldest date first.
--
-- Passwords and email confirmation are handled by Supabase Auth (auth.users);
-- passwords are stored there hashed and never appear in any table below.
--
-- Students can only sign up with a code their school received. Schools buy a
-- yearly subscription; each paid student gets one code. Once the subscription
-- ends, students keep their accounts but lose access until the school renews.
--
-- Upgrading from the version without school codes? It only held test data.
-- Run these lines first, then this whole file, then delete the old test users
-- in Authentication -> Users (they have no school, so they have no profile):
--   drop trigger if exists on_auth_user_confirmed on auth.users;
--   drop function if exists public.handle_confirmed_user();
--   drop function if exists public.username_available(text);
--   drop table if exists public.profiles;

-- ---------------------------------------------------------------------------
-- Schools and their codes. Managed by Mokify only (SQL editor / server code);
-- the website's public key can neither read nor change them.
-- ---------------------------------------------------------------------------

create table public.schools (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(name) between 2 and 200),
  contact_email     text check (char_length(contact_email) <= 254),
  -- Last day (Lithuanian time) the subscription covers.
  subscription_ends date not null,
  created_at        timestamptz not null default now()
);

-- One code per student, stored as its 8 random characters. Students see it as
-- MOK-XXXX-XXXX. The alphabet leaves out 0/O and 1/I/L so codes copied from
-- paper aren't mistyped.
create table public.access_codes (
  code         text primary key check (code ~ '^[A-HJKMNP-Z2-9]{8}$'),
  school_id    uuid not null references public.schools (id) on delete cascade,
  -- Set when a student signs up with the code. If that student's account is
  -- deleted the code becomes free again.
  redeemed_by  uuid unique references auth.users (id) on delete set null,
  redeemed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index access_codes_school_id on public.access_codes (school_id);

alter table public.schools enable row level security;
alter table public.access_codes enable row level security;
revoke all on public.schools from anon, authenticated;
revoke all on public.access_codes from anon, authenticated;

create function public.today_lt()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Vilnius')::date;
$$;

-- Accepts what a student types ("mok-7kq2 x9pd", "7KQ2X9PD", ...) and returns
-- the stored form.
create function public.normalize_access_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when c ~ '^MOK.{8}$' then substr(c, 4) else c end
  from (select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) as c) s;
$$;

-- Creates codes for a school and returns them ready to hand out. Run from the
-- SQL editor and use "Export -> CSV" on the result, e.g.:
--   insert into public.schools (name, contact_email, subscription_ends)
--   values ('Example gimnazija', 'it@example.lt', '2027-08-31') returning id;
--   select * from public.create_access_codes('<school id>', 120);
create function public.create_access_codes(p_school_id uuid, p_count int)
returns table (access_code text)
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  b int;
begin
  if p_count is null or p_count not between 1 and 5000 then
    raise exception 'p_count must be between 1 and 5000';
  end if;

  for n in 1..p_count loop
    loop
      v_code := '';
      while length(v_code) < 8 loop
        b := get_byte(extensions.gen_random_bytes(1), 0);
        -- 248 = 8 * 31: dropping higher bytes keeps every character equally likely.
        if b < 248 then
          v_code := v_code || substr(alphabet, b % 31 + 1, 1);
        end if;
      end loop;
      insert into public.access_codes (code, school_id) values (v_code, p_school_id)
      on conflict do nothing;
      exit when found;
    end loop;
    access_code := 'MOK-' || substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
    return next;
  end loop;
end;
$$;

revoke all on function public.create_access_codes(uuid, int) from public, anon, authenticated;

-- Lets the sign-up page check a code before showing the form. Answers only
-- 'valid', 'used', 'expired' or 'invalid' for the one code it is given.
-- A code held by an account whose email was never confirmed counts as free,
-- so a student who mistyped their email can simply sign up again.
create function public.access_code_status(p_code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when u.email_confirmed_at is not null then 'used'
      when s.subscription_ends < public.today_lt() then 'expired'
      else 'valid'
    end
    from public.access_codes c
    join public.schools s on s.id = c.school_id
    left join auth.users u on u.id = c.redeemed_by
    where c.code = public.normalize_access_code(p_code)
  ), 'invalid');
$$;

revoke all on function public.access_code_status(text) from public;
grant execute on function public.access_code_status(text) to anon, authenticated;

-- Every new account must bring a valid code; otherwise the sign-up is refused.
-- This runs in the database, so it also stops sign-ups that skip the website.
-- (Users added by hand in the Supabase dashboard need a code in their metadata
-- too: {"access_code": "MOK-XXXX-XXXX", ...}.)
create function public.claim_access_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.access_codes c
     set redeemed_by = new.id,
         redeemed_at = now()
    from public.schools s
   where c.code = public.normalize_access_code(new.raw_user_meta_data ->> 'access_code')
     and s.id = c.school_id
     and s.subscription_ends >= public.today_lt()
     and not exists (
       select 1 from auth.users u
        where u.id = c.redeemed_by and u.email_confirmed_at is not null
     );

  if not found then
    raise exception 'Invalid, used or expired access code';
  end if;
  return new;
end;
$$;

-- Must fire before on_auth_user_confirmed (triggers run in name order), so the
-- code is claimed before the profile looks it up.
create trigger claim_access_code_on_signup
  after insert on auth.users
  for each row
  execute function public.claim_access_code();

-- ---------------------------------------------------------------------------
-- Student profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  school_id   uuid not null references public.schools (id),
  full_name   text not null check (char_length(full_name) between 3 and 80),
  username    text not null check (username ~ '^[A-Za-z0-9_.]{3,20}$'),
  email       text not null check (char_length(email) <= 254),
  grade       smallint not null check (grade between 5 and 12),
  avatar      text not null default 'assets/img/default-avatar.svg'
              check (
                avatar = 'assets/img/default-avatar.svg'
                or (avatar like 'data:image/jpeg;base64,%' and char_length(avatar) <= 150000)
              ),
  created_at  timestamptz not null default now()
);

create unique index profiles_username_unique on public.profiles (lower(username));
create unique index profiles_email_unique    on public.profiles (lower(email));
create index profiles_school_id on public.profiles (school_id);

-- Creates the profile once the email is confirmed (also covers projects that
-- have "Confirm email" switched off, where the user is confirmed on insert).
-- If someone else confirmed an account with the same code first, this
-- account has no code any more and confirmation is refused.
create function public.handle_confirmed_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school_id uuid;
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  select school_id into v_school_id from public.access_codes where redeemed_by = new.id;
  if v_school_id is null then
    raise exception 'This account has no access code';
  end if;

  insert into public.profiles (id, school_id, full_name, username, email, grade)
  values (
    new.id,
    v_school_id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'username',
    lower(new.email),
    (new.raw_user_meta_data ->> 'grade')::smallint
  );
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function public.handle_confirmed_user();

-- Lets the sign-up form say "username taken" before sending anything.
-- Answers only yes/no for one name; it cannot list or read profiles.
create function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(p_username)
  );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- Whether the signed-in student's school subscription is still running.
-- Students of a school that didn't renew keep their account and can still sign
-- in and see their profile, but every learning feature's row-level-security
-- policy should require this, e.g.  using (public.has_active_access()).
create function public.has_active_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      join public.schools s on s.id = p.school_id
     where p.id = auth.uid()
       and s.subscription_ends >= public.today_lt()
  );
$$;

revoke all on function public.has_active_access() from public;
grant execute on function public.has_active_access() to authenticated;

-- Nobody can read or change profiles with the public key. A signed-in student
-- can read their own row and change only their own picture.
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (avatar) on public.profiles to authenticated;

create policy "Read own profile" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

create policy "Update own avatar" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
