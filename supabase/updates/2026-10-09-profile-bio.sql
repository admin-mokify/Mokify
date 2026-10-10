-- Optional "about me" text on profiles, and students editing their own
-- username and description on the account page. Run once, after the
-- earlier files in this folder:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.

alter table public.profiles
  add column bio text not null default '' check (char_length(bio) <= 300);

-- A signed-in student may change their own picture, username and description
-- (the "Update own avatar" policy already limits them to their own row).
-- Usernames keep their format check and stay unique (profiles_username_unique).
grant update (avatar, username, bio) on public.profiles to authenticated;

alter policy "Update own avatar" on public.profiles rename to "Update own profile";

-- Same as before, plus the optional description from the sign-up form.
create or replace function public.handle_confirmed_user()
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

  insert into public.profiles (id, school_id, full_name, username, email, grade, bio)
  values (
    new.id,
    v_school_id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'username',
    lower(new.email),
    (new.raw_user_meta_data ->> 'grade')::smallint,
    left(trim(coalesce(new.raw_user_meta_data ->> 'bio', '')), 300)
  );
  return new;
end;
$$;
