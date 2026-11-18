-- User management on the website (vartotojai.html) and per-person settings
-- for the administration pages. Run once, after 2026-11-19-admin-codes.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * Only admins (public.admins) can search, look at, change or delete users.
-- * An admin may set any name (1-80 characters, one word is fine): the
--   two-word rule only applies when students change their own name. A
--   username keeps its format (3-20 letters, digits, "_" or "."), because
--   students log in with it and the login form only accepts that format.
-- * Deleting a user deletes their account and everything that belongs to it
--   (profile, messages, lessons, teacher profile and documents...); their
--   registration code becomes free again. An admin can't delete themselves
--   or another admin. The website then removes the user's uploaded files.
-- * Every change and deletion is written to public.admin_log (who, what,
--   when), which only Mokify can read.
-- * public.staff_prefs remembers, per admin or reviewer, the order of the
--   tools on admin.html and whether deleting asks for confirmation (it does
--   unless switched off).

-- ---------------------------------------------------------------------------
-- Names: 1-80 characters instead of 3-80 (any name an admin sets).
-- ---------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_full_name_check;
alter table public.profiles
  add constraint profiles_full_name_check check (char_length(btrim(full_name)) between 1 and 80);

-- ---------------------------------------------------------------------------
-- Settings and log
-- ---------------------------------------------------------------------------

create table public.staff_prefs (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  tool_order      text[] not null default '{}' check (cardinality(tool_order) <= 50),
  confirm_delete  boolean not null default true,
  updated_at      timestamptz not null default now()
);

alter table public.staff_prefs enable row level security;
revoke all on public.staff_prefs from anon, authenticated;

create table public.admin_log (
  id               bigint generated always as identity primary key,
  admin_id         uuid references public.profiles (id) on delete set null,
  action           text not null check (action in ('update_user', 'delete_user')),
  target_id        uuid not null,
  target_username  text,
  details          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

alter table public.admin_log enable row level security;
revoke all on public.admin_log from anon, authenticated;

create function public.is_staff(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = p_user)
      or exists (select 1 from public.reviewers where user_id = p_user);
$$;

revoke all on function public.is_staff(uuid) from public, anon, authenticated;

-- { ok, tool_order: [...], confirm_delete }
create function public.staff_prefs_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefs public.staff_prefs;
begin
  if auth.uid() is null or not public.is_staff(auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into v_prefs from public.staff_prefs where user_id = auth.uid();
  return jsonb_build_object(
    'ok', true,
    'tool_order', to_jsonb(coalesce(v_prefs.tool_order, '{}'::text[])),
    'confirm_delete', coalesce(v_prefs.confirm_delete, true));
end;
$$;

revoke all on function public.staff_prefs_get() from public, anon, authenticated;
grant execute on function public.staff_prefs_get() to authenticated;

-- Saves whichever of the two is given (null leaves it as it is).
create function public.staff_prefs_save(p_tool_order text[] default null, p_confirm_delete boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_staff(auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_tool_order is not null and (
       cardinality(p_tool_order) > 50
       or exists (select 1 from unnest(p_tool_order) t where t !~ '^[a-z0-9_-]{1,30}$')
     ) then
    return jsonb_build_object('ok', false, 'error', 'bad_order');
  end if;

  insert into public.staff_prefs (user_id, tool_order, confirm_delete)
  values (auth.uid(), coalesce(p_tool_order, '{}'), coalesce(p_confirm_delete, true))
  on conflict (user_id) do update
     set tool_order = coalesce(p_tool_order, staff_prefs.tool_order),
         confirm_delete = coalesce(p_confirm_delete, staff_prefs.confirm_delete),
         updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.staff_prefs_save(text[], boolean) from public, anon, authenticated;
grant execute on function public.staff_prefs_save(text[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

-- Users whose name, username, email or school contains p_query (all words
-- of it), newest first, at most 100. An empty query lists the newest.
-- { ok, total, users: [{ id, full_name, username, email, school, grade, created_at, teacher, admin, me }] }
create function public.admin_users(p_query text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_words  text[];
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- Each word, with LIKE's own wildcards taken literally.
  select coalesce(array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'), '{}')
    into v_words
    from regexp_split_to_table(btrim(left(coalesce(p_query, ''), 100)), '\s+') w
   where w <> '';

  return (
    with found as (
      select p.*, s.name as school_name
        from public.profiles p
        join public.schools s on s.id = p.school_id
       where not exists (
               select 1 from unnest(v_words) w
                where not (p.full_name ilike w or p.username ilike w or p.email ilike w or s.name ilike w)
             )
    )
    select jsonb_build_object(
      'ok', true,
      'total', (select count(*) from found),
      'users', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', f.id, 'full_name', f.full_name, 'username', f.username, 'email', f.email,
                 'school', f.school_name, 'grade', f.grade, 'created_at', f.created_at,
                 'teacher', exists (select 1 from public.teacher_profiles t where t.id = f.id),
                 'admin', exists (select 1 from public.admins a where a.user_id = f.id),
                 'me', f.id = v_me
               ) order by f.created_at desc)
          from (select * from found order by created_at desc limit 100) f
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.admin_users(text) from public, anon, authenticated;
grant execute on function public.admin_users(text) to authenticated;

-- Everything about one user that the admin page shows.
create function public.admin_user(p_user uuid)
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
    'admin', exists (select 1 from public.admins a where a.user_id = v_p.id),
    'reviewer', exists (select 1 from public.reviewers r where r.user_id = v_p.id),
    'me', v_p.id = v_me
  ));
end;
$$;

revoke all on function public.admin_user(uuid) from public, anon, authenticated;
grant execute on function public.admin_user(uuid) to authenticated;

-- Changes a user's name, username and class. The name may be anything of
-- 1-80 characters; the username keeps its login format and must be free.
create function public.admin_update_user(p_user uuid, p_full_name text, p_username text, p_grade int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_old    public.profiles;
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_user   text := btrim(coalesce(p_username, ''));
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into v_old from public.profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if char_length(v_name) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if v_user !~ '^[A-Za-z0-9_.]{3,20}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_username');
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(v_user) and id <> p_user) then
    return jsonb_build_object('ok', false, 'error', 'username_taken');
  end if;
  if p_grade is null or p_grade not between 5 and 12 then
    return jsonb_build_object('ok', false, 'error', 'bad_grade');
  end if;

  update public.profiles
     set full_name = v_name, username = v_user, grade = p_grade
   where id = p_user;

  insert into public.admin_log (admin_id, action, target_id, target_username, details)
  values (v_me, 'update_user', p_user, v_user, jsonb_build_object(
    'before', jsonb_build_object('full_name', v_old.full_name, 'username', v_old.username, 'grade', v_old.grade),
    'after', jsonb_build_object('full_name', v_name, 'username', v_user, 'grade', p_grade)));

  return jsonb_build_object('ok', true, 'user', jsonb_build_object(
    'id', p_user, 'full_name', v_name, 'username', v_user, 'grade', p_grade));
end;
$$;

revoke all on function public.admin_update_user(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.admin_update_user(uuid, text, text, int) to authenticated;

-- Deletes a user's account and everything that belongs to it. Returns the
-- paths of their uploaded documents so the website can remove the files.
-- { ok, files: [...] }
create function public.admin_delete_user(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_p      public.profiles;
  v_files  jsonb;
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_user = v_me then
    return jsonb_build_object('ok', false, 'error', 'self');
  end if;
  if exists (select 1 from public.admins where user_id = p_user) then
    return jsonb_build_object('ok', false, 'error', 'admin');
  end if;
  select * into v_p from public.profiles where id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(jsonb_agg(d.storage_path), '[]'::jsonb) into v_files
    from public.teacher_documents d where d.teacher_id = p_user;

  insert into public.admin_log (admin_id, action, target_id, target_username, details)
  values (v_me, 'delete_user', p_user, v_p.username, jsonb_build_object(
    'full_name', v_p.full_name, 'email', v_p.email, 'school_id', v_p.school_id));

  -- The profile and everything hanging off it go with the account.
  delete from auth.users where id = p_user;

  return jsonb_build_object('ok', true, 'files', v_files);
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- Admins may remove uploaded documents (of users they deleted). Deleting
-- needs the file to be visible too, so admins may also read them.
create policy "Admins read teacher documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'teacher-documents' and public.is_admin());

create policy "Admins delete teacher documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'teacher-documents' and public.is_admin());

-- A quick check: the admins who can use the page.
select p.username, p.full_name from public.admins a join public.profiles p on p.id = a.user_id;
