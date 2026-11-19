-- Finding someone by username in Žinutės, and choosing who may start a chat
-- with you (paskyra.html). Run once, after 2026-11-28-leaderboard-hide.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * profiles.messages_from:
--     'teachers' (default, same as before): a new chat can only be started
--       with you from the teacher list (if you teach); anyone you wrote to
--       first can always answer.
--     'everyone': any student whose school has Mokify may find you by
--       username and write to you.
-- * Blocking still wins over both, and so does an ended subscription.
-- * The search only finds people the searcher may write to, matches the
--   start of the username (at least 2 characters) and gives at most 10.

alter table public.profiles
  add column messages_from text not null default 'teachers'
    check (messages_from in ('teachers', 'everyone'));

-- Same as before (2026-11-11-blocks-hidden-chats.sql), and students who
-- chose 'everyone'.
create or replace function public.can_message(p_partner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_active_access()
     and p_partner <> auth.uid()
     and not public.is_blocked_between(auth.uid(), p_partner)
     and (
       exists (
         select 1
           from public.profiles p
           join public.schools s on s.id = p.school_id
          where p.id = p_partner
            and s.subscription_ends >= public.today_lt()
            and (p.messages_from = 'everyone'
                 or exists (select 1 from public.teacher_profiles t where t.id = p.id))
       )
       or exists (
         select 1 from public.messages m
          where m.sender_id = p_partner and m.recipient_id = auth.uid()
       )
     );
$$;

-- Same as before, and also students who chose 'everyone' (so their chat and
-- profile window can open from the search).
create or replace function public.chat_partner(p_id uuid)
returns table (
  id               uuid,
  full_name        text,
  username         text,
  avatar           text,
  bio              text,
  grade            smallint,
  school_name      text,
  is_teacher       boolean,
  subjects         text[],
  levels           text[],
  diplomas         text[],
  grades_verified  boolean,
  can_message      boolean,
  blocked_by_me    boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select them.id, them.full_name, them.username, them.avatar, them.bio, them.grade, s.name,
         t.id is not null, t.subjects, t.levels,
         array(
           select d.title from public.teacher_documents d
            where d.teacher_id = them.id and d.kind = 'diploma' and d.status = 'verified'
            order by d.created_at
         ),
         exists (
           select 1 from public.teacher_documents d
            where d.teacher_id = them.id and d.kind = 'grades' and d.status = 'verified'
         ),
         public.can_message(them.id),
         exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = them.id)
    from public.profiles them
    join public.schools s on s.id = them.school_id
    left join public.teacher_profiles t on t.id = them.id
   where them.id = p_id
     and them.id <> auth.uid()
     and not exists (select 1 from public.blocks b where b.blocker_id = them.id and b.blocked_id = auth.uid())
     and (
       t.id is not null
       or them.messages_from = 'everyone'
       or exists (
         select 1 from public.messages m
          where (m.sender_id = them.id and m.recipient_id = auth.uid())
             or (m.sender_id = auth.uid() and m.recipient_id = them.id)
       )
     );
$$;

revoke all on function public.chat_partner(uuid) from public, anon;
grant execute on function public.chat_partner(uuid) to authenticated;

-- Usernames starting with p_query (an "@" in front is fine), only people
-- the caller may write to, at most 10, an exact match first.
create function public.find_users(p_query text)
returns table (id uuid, full_name text, username text, avatar text, is_teacher boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(regexp_replace(ltrim(btrim(coalesce(p_query, '')), '@'), '[^A-Za-z0-9_.]', '', 'g'));
begin
  if auth.uid() is null or char_length(v_q) < 2 or char_length(v_q) > 20 or not public.has_active_access() then
    return;
  end if;
  return query
    select p.id, p.full_name, p.username, p.avatar,
           exists (select 1 from public.teacher_profiles t where t.id = p.id)
      from public.profiles p
     where left(lower(p.username), char_length(v_q)) = v_q
       and p.id <> auth.uid()
       and not exists (select 1 from public.blocks b where b.blocker_id = p.id and b.blocked_id = auth.uid())
       and public.can_message(p.id)
     order by lower(p.username) = v_q desc, lower(p.username)
     limit 10;
end;
$$;

revoke all on function public.find_users(text) from public, anon, authenticated;
grant execute on function public.find_users(text) to authenticated;

-- { ok, messages_from } for the logged-in student.
create function public.my_message_privacy()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then jsonb_build_object('ok', false, 'error', 'forbidden')
         else coalesce((select jsonb_build_object('ok', true, 'messages_from', p.messages_from)
                          from public.profiles p where p.id = auth.uid()),
                       jsonb_build_object('ok', false, 'error', 'not_found')) end;
$$;

revoke all on function public.my_message_privacy() from public, anon, authenticated;
grant execute on function public.my_message_privacy() to authenticated;

-- Sets who may start a chat with the logged-in student. { ok, messages_from }
create function public.set_message_privacy(p_value text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_value is null or p_value not in ('teachers', 'everyone') then
    return jsonb_build_object('ok', false, 'error', 'bad_value');
  end if;
  update public.profiles set messages_from = p_value where id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'messages_from', p_value);
end;
$$;

revoke all on function public.set_message_privacy(text) from public, anon, authenticated;
grant execute on function public.set_message_privacy(text) to authenticated;
