-- Students can change their full name on the account page. Run once, after the
-- earlier files in this folder:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.

-- A full name is at least two words (first and last name) with no digits.
-- The website checks this more strictly (letters only); this is the backstop
-- for requests that skip the website.
create function public.is_valid_full_name(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(trim(p_name) ~ '^\S+(\s+\S+)+$' and p_name !~ '[0-9]', false);
$$;

grant update (full_name) on public.profiles to authenticated;

-- The rule applies to students (sign-ups and changes from the website). Mokify
-- itself, working in the SQL editor, may set any name, e.g. a one-word name
-- for a test account.
create function public.check_full_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.full_name is distinct from old.full_name
     and not public.is_valid_full_name(new.full_name) then
    raise exception 'Full name must be at least two words without digits'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_full_name_on_update
  before update of full_name on public.profiles
  for each row
  execute function public.check_full_name();

-- Sign-ups: same rule, checked together with the access code, so an account
-- with a one-word name is never created through the website or its API.
create or replace function public.claim_access_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_valid_full_name(new.raw_user_meta_data ->> 'full_name') then
    raise exception 'Full name must be at least two words without digits';
  end if;

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

-- The test account: one-word name, allowed because it is set here.
update public.profiles set full_name = 'Test' where lower(username) = 'test';
