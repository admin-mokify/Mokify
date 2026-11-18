-- Custom titles (like "Registruotas mokytojas", but made up by an admin):
-- a name, a colour and an icon, given to users in vartotojai.html. Run once,
-- after 2026-11-25-ratings.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * public.titles holds each title once ("Beta testeris", "Admin", ...);
--   public.user_titles says who has which. Changing a title changes it for
--   everyone who has it; deleting it takes it away from everyone.
-- * Only admins (public.admins) create, change, give or take away titles.
--   Every change is written to public.admin_log.
-- * Logged-in users see titles beside names (user_titles); never the
--   tables themselves.

create table public.titles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40 and name = btrim(name)),
  color       text not null check (color ~ '^#[0-9a-f]{6}$'),
  icon        text check (icon ~ '^[a-z0-9-]{1,24}$'),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null
);

-- One title per name, ignoring capitals (also Lithuanian ones).
create unique index titles_name_key
  on public.titles (lower(translate(name, 'ĄČĘĖĮŠŲŪŽ', 'ąčęėįšųūž')));

create table public.user_titles (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  title_id  uuid not null references public.titles (id) on delete cascade,
  added_at  timestamptz not null default now(),
  added_by  uuid references public.profiles (id) on delete set null,
  primary key (user_id, title_id)
);
create index user_titles_title_idx on public.user_titles (title_id);

alter table public.titles enable row level security;
alter table public.user_titles enable row level security;
revoke all on public.titles from anon, authenticated;
revoke all on public.user_titles from anon, authenticated;

alter table public.admin_log drop constraint if exists admin_log_action_check;
alter table public.admin_log add constraint admin_log_action_check check (
  action in ('update_user', 'delete_user', 'update_school', 'extend_school', 'delete_school', 'delete_codes',
             'adjust_points', 'save_title', 'delete_title', 'give_title', 'remove_title')
);

-- A user's titles, oldest first, as JSON (for the admin answers below).
create function public.titles_of(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color, 'icon', t.icon)
                            order by ut.added_at, t.name), '[]'::jsonb)
    from public.user_titles ut
    join public.titles t on t.id = ut.title_id
   where ut.user_id = p_user;
$$;

revoke all on function public.titles_of(uuid) from public, anon, authenticated;

-- Titles beside names, for any logged-in user: one row per (user, title),
-- for up to 500 users at a time.
create function public.user_titles(p_ids uuid[])
returns table (user_id uuid, id uuid, name text, color text, icon text)
language sql
stable
security definer
set search_path = ''
as $$
  select ut.user_id, t.id, t.name, t.color, t.icon
    from public.user_titles ut
    join public.titles t on t.id = ut.title_id
   where auth.uid() is not null
     and coalesce(cardinality(p_ids), 0) <= 500
     and ut.user_id = any (p_ids)
   order by ut.user_id, ut.added_at, t.name;
$$;

revoke all on function public.user_titles(uuid[]) from public, anon, authenticated;
grant execute on function public.user_titles(uuid[]) to authenticated;

-- Every title, with how many users have it.
-- { ok, titles: [{ id, name, color, icon, users }] }
create function public.admin_titles()
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
  return jsonb_build_object('ok', true, 'titles', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'name', t.name, 'color', t.color, 'icon', t.icon,
             'users', (select count(*) from public.user_titles ut where ut.title_id = t.id))
           order by lower(translate(t.name, 'ĄČĘĖĮŠŲŪŽ', 'ąčęėįšųūž'))), '[]'::jsonb)
      from public.titles t));
end;
$$;

revoke all on function public.admin_titles() from public, anon, authenticated;
grant execute on function public.admin_titles() to authenticated;

-- Creates a title (p_id null) or changes one. Colour '#rrggbb'; icon a short
-- name from the site's list, or null for none.
-- { ok, title } or { ok: false, error: bad_name | bad_color | bad_icon | name_taken | not_found }
create function public.admin_save_title(p_id uuid, p_name text, p_color text, p_icon text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_name   text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_color  text := lower(btrim(coalesce(p_color, '')));
  v_icon   text := nullif(btrim(coalesce(p_icon, '')), '');
  v_t      public.titles;
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if v_color !~ '^#[0-9a-f]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_color');
  end if;
  if v_icon is not null and v_icon !~ '^[a-z0-9-]{1,24}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_icon');
  end if;
  if exists (select 1 from public.titles t
              where lower(translate(t.name, 'ĄČĘĖĮŠŲŪŽ', 'ąčęėįšųūž')) = lower(translate(v_name, 'ĄČĘĖĮŠŲŪŽ', 'ąčęėįšųūž'))
                and t.id is distinct from p_id) then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
  end if;

  if p_id is null then
    insert into public.titles (name, color, icon, created_by)
    values (v_name, v_color, v_icon, v_me)
    returning * into v_t;
  else
    update public.titles set name = v_name, color = v_color, icon = v_icon
     where id = p_id
    returning * into v_t;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;

  insert into public.admin_log (admin_id, action, target_id, target_username, details)
  values (v_me, 'save_title', v_t.id, null,
          jsonb_build_object('name', v_t.name, 'color', v_t.color, 'icon', v_t.icon, 'new', p_id is null));

  return jsonb_build_object('ok', true, 'title', jsonb_build_object(
    'id', v_t.id, 'name', v_t.name, 'color', v_t.color, 'icon', v_t.icon,
    'users', (select count(*) from public.user_titles ut where ut.title_id = v_t.id)));
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
end;
$$;

revoke all on function public.admin_save_title(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_save_title(uuid, text, text, text) to authenticated;

-- Deletes a title, taking it away from everyone. { ok, users } (how many had it).
create function public.admin_delete_title(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_t      public.titles;
  v_users  int;
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into v_t from public.titles where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select count(*) into v_users from public.user_titles where title_id = p_id;
  delete from public.titles where id = p_id;

  insert into public.admin_log (admin_id, action, target_id, target_username, details)
  values (v_me, 'delete_title', p_id, null, jsonb_build_object('name', v_t.name, 'users', v_users));

  return jsonb_build_object('ok', true, 'users', v_users);
end;
$$;

revoke all on function public.admin_delete_title(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_title(uuid) to authenticated;

-- Gives a title to a user (p_on true) or takes it away (false). A user can
-- have up to 10 titles. { ok, titles } (the user's titles afterwards) or
-- { ok: false, error: not_found | too_many }.
create function public.admin_set_title(p_user uuid, p_title uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_uname  text;
  v_tname  text;
  v_n      int;
begin
  if v_me is null or not exists (select 1 from public.admins where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select username into v_uname from public.profiles where id = p_user for update;
  select name into v_tname from public.titles where id = p_title;
  if v_uname is null or v_tname is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if coalesce(p_on, false) then
    if not exists (select 1 from public.user_titles where user_id = p_user and title_id = p_title) then
      select count(*) into v_n from public.user_titles where user_id = p_user;
      if v_n >= 10 then
        return jsonb_build_object('ok', false, 'error', 'too_many', 'titles', public.titles_of(p_user));
      end if;
      insert into public.user_titles (user_id, title_id, added_by) values (p_user, p_title, v_me);
      insert into public.admin_log (admin_id, action, target_id, target_username, details)
      values (v_me, 'give_title', p_user, v_uname, jsonb_build_object('title', v_tname));
    end if;
  else
    delete from public.user_titles where user_id = p_user and title_id = p_title;
    if found then
      insert into public.admin_log (admin_id, action, target_id, target_username, details)
      values (v_me, 'remove_title', p_user, v_uname, jsonb_build_object('title', v_tname));
    end if;
  end if;

  return jsonb_build_object('ok', true, 'titles', public.titles_of(p_user));
end;
$$;

revoke all on function public.admin_set_title(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_title(uuid, uuid, boolean) to authenticated;
