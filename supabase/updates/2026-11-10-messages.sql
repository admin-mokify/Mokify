-- Messages between students (zinutes.html). Run once, after
-- 2026-11-10-school-teachers.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- Rules:
--  * Students only message students from their own school.
--  * A conversation can only be started with a teacher. Anyone who received a
--    message can answer it, so teachers can reply to the students who wrote.
--  * Sending needs a running school subscription; reading old messages doesn't.
--  * Messages can't be edited or deleted from the website. They go away with
--    the sender's or recipient's account (on delete cascade).

create table public.messages (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  body          text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  check (sender_id <> recipient_id)
);

create index messages_pair on public.messages (
  least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at desc
);
create index messages_unread on public.messages (recipient_id) where read_at is null;

-- Whether the signed-in student may send a message to p_partner.
create function public.can_message(p_partner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_active_access()
     and exists (
       select 1
         from public.profiles me
         join public.profiles them on them.school_id = me.school_id
        where me.id = auth.uid() and them.id = p_partner and them.id <> me.id
     )
     and (
       exists (select 1 from public.teacher_profiles t where t.id = p_partner)
       or exists (
         select 1 from public.messages m
          where m.sender_id = p_partner and m.recipient_id = auth.uid()
       )
     );
$$;

revoke all on function public.can_message(uuid) from public;
grant execute on function public.can_message(uuid) to authenticated;

-- A student reads the messages they sent or received and sends new ones.
-- sender_id and created_at are always filled in by the database.
alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
grant insert (recipient_id, body) on public.messages to authenticated;

create policy "Read own messages" on public.messages
  for select to authenticated
  using (auth.uid() in (sender_id, recipient_id));

create policy "Send messages" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.can_message(recipient_id));

-- The conversation list: everyone the student has exchanged messages with,
-- newest first, with the last message and how many are unread.
create function public.my_conversations()
returns table (
  partner_id    uuid,
  full_name     text,
  username      text,
  avatar        text,
  last_body     text,
  last_from_me  boolean,
  last_at       timestamptz,
  unread        int,
  can_reply     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select case when m.sender_id = auth.uid() then m.recipient_id else m.sender_id end as partner,
           m.sender_id, m.recipient_id, m.body, m.created_at, m.read_at
      from public.messages m
     where auth.uid() in (m.sender_id, m.recipient_id)
  ),
  latest as (
    select distinct on (partner) partner, body, sender_id = auth.uid() as from_me, created_at
      from mine
     order by partner, created_at desc
  )
  select l.partner, p.full_name, p.username, p.avatar, l.body, l.from_me, l.created_at,
         (select count(*)::int from mine x
           where x.partner = l.partner and x.recipient_id = auth.uid() and x.read_at is null),
         public.can_message(l.partner)
    from latest l
    join public.profiles p on p.id = l.partner
   order by l.created_at desc;
$$;

revoke all on function public.my_conversations() from public;
grant execute on function public.my_conversations() to authenticated;

-- Name and picture of someone from the student's school, for opening a new
-- conversation (e.g. from the teacher list). No row for anyone else.
create function public.chat_partner(p_id uuid)
returns table (id uuid, full_name text, username text, avatar text, can_message boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select them.id, them.full_name, them.username, them.avatar, public.can_message(them.id)
    from public.profiles me
    join public.profiles them on them.school_id = me.school_id
   where me.id = auth.uid() and them.id = p_id and them.id <> me.id;
$$;

revoke all on function public.chat_partner(uuid) from public;
grant execute on function public.chat_partner(uuid) to authenticated;

-- Marks everything p_partner sent the signed-in student as read.
create function public.mark_conversation_read(p_partner uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages
     set read_at = now()
   where recipient_id = auth.uid() and sender_id = p_partner and read_at is null;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Unread messages, for the count beside "Žinutės" in the menu.
create function public.unread_message_count()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.messages
   where recipient_id = auth.uid() and read_at is null;
$$;

revoke all on function public.unread_message_count() from public;
grant execute on function public.unread_message_count() to authenticated;
