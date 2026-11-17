-- Teachers teach students from every school, not only their own. Run once,
-- after 2026-11-10-messages.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * The teacher list (mokytojai.html) shows teachers from all schools whose
--   subscription is running, with their school's name.
-- * Students can filter it by school, so signed-in students can list the
--   names of schools with a running subscription.
-- * Messages: a student may start a conversation with any such teacher, and
--   anyone who received a message can still answer it.

drop function if exists public.school_teachers();

create function public.find_teachers()
returns table (
  id                 uuid,
  full_name          text,
  username           text,
  avatar             text,
  bio                text,
  grade              smallint,
  school_id          uuid,
  school_name        text,
  subjects           text[],
  levels             text[],
  verified_documents int
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.username, p.avatar, p.bio, p.grade, s.id, s.name, t.subjects, t.levels,
         (select count(*)::int
            from public.teacher_documents d
           where d.teacher_id = t.id and d.status = 'verified')
    from public.teacher_profiles t
    join public.profiles p on p.id = t.id
    join public.schools s on s.id = p.school_id
   where p.id <> auth.uid()
     and s.subscription_ends >= public.today_lt()
     and public.has_active_access()
   order by p.full_name;
$$;

revoke all on function public.find_teachers() from public;
grant execute on function public.find_teachers() to authenticated;

-- Schools for the school filter, the student's own marked.
create function public.list_schools()
returns table (id uuid, name text, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.id = (select p.school_id from public.profiles p where p.id = auth.uid())
    from public.schools s
   where s.subscription_ends >= public.today_lt()
     and public.has_active_access()
   order by s.name;
$$;

revoke all on function public.list_schools() from public;
grant execute on function public.list_schools() to authenticated;

-- Any teacher of a school with a running subscription can be written to;
-- anyone who wrote to the student can be answered.
create or replace function public.can_message(p_partner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_active_access()
     and p_partner <> auth.uid()
     and (
       exists (
         select 1
           from public.teacher_profiles t
           join public.profiles p on p.id = t.id
           join public.schools s on s.id = p.school_id
          where t.id = p_partner and s.subscription_ends >= public.today_lt()
       )
       or exists (
         select 1 from public.messages m
          where m.sender_id = p_partner and m.recipient_id = auth.uid()
       )
     );
$$;

-- Name and picture for opening a conversation: any teacher, or anyone the
-- student already exchanged messages with.
create or replace function public.chat_partner(p_id uuid)
returns table (id uuid, full_name text, username text, avatar text, can_message boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select them.id, them.full_name, them.username, them.avatar, public.can_message(them.id)
    from public.profiles them
   where them.id = p_id
     and them.id <> auth.uid()
     and (
       exists (select 1 from public.teacher_profiles t where t.id = them.id)
       or exists (
         select 1 from public.messages m
          where (m.sender_id = them.id and m.recipient_id = auth.uid())
             or (m.sender_id = auth.uid() and m.recipient_id = them.id)
       )
     );
$$;
