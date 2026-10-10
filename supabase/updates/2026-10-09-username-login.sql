-- Log in with a username instead of an email, and show the student's school on
-- the account page. Run once, after schema.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.

-- Wrong passwords per username. The username login answers database calls
-- directly, so without this anyone could guess a student's password endlessly.
-- After 10 wrong passwords within 15 minutes, that username is locked until
-- those 15 minutes are over.
create table public.login_attempts (
  username        text primary key,
  failed_count    int not null,
  first_failed_at timestamptz not null default now()
);

alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;

-- Returns the email to log in with for a username, but only when the password
-- is right as well, so it never reveals anyone's email. The website then logs
-- in with that email and password as usual. Also finds accounts whose email
-- isn't confirmed yet: they have no profile row, only their sign-up details.
-- Answers {"status": "ok", "email": ...}, {"status": "invalid"} or {"status": "locked"}.
create function public.login_email(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text := lower(trim(coalesce(p_username, '')));
  v_email text;
begin
  if v_name = '' or coalesce(p_password, '') = '' then
    return jsonb_build_object('status', 'invalid');
  end if;

  delete from public.login_attempts
   where username = v_name and first_failed_at < now() - interval '15 minutes';

  if exists (select 1 from public.login_attempts where username = v_name and failed_count >= 10) then
    return jsonb_build_object('status', 'locked');
  end if;

  select u.email into v_email
    from auth.users u
    left join public.profiles p on p.id = u.id
   where lower(coalesce(p.username, u.raw_user_meta_data ->> 'username')) = v_name
     and (p.id is not null or u.email_confirmed_at is null)
     and case
           when u.encrypted_password like '$2%'
           then u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
           else false
         end
   limit 1;

  if v_email is null then
    insert into public.login_attempts as a (username, failed_count) values (v_name, 1)
    on conflict (username) do update set failed_count = a.failed_count + 1;
    return jsonb_build_object('status', 'invalid');
  end if;

  delete from public.login_attempts where username = v_name;
  return jsonb_build_object('status', 'ok', 'email', v_email);
end;
$$;

revoke all on function public.login_email(text, text) from public;
grant execute on function public.login_email(text, text) to anon, authenticated;

-- The signed-in student's school, for the account page.
create function public.my_school()
returns table (name text, subscription_ends date, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name, s.subscription_ends, s.subscription_ends >= public.today_lt()
    from public.profiles p
    join public.schools s on s.id = p.school_id
   where p.id = auth.uid();
$$;

revoke all on function public.my_school() from public;
grant execute on function public.my_school() to authenticated;
