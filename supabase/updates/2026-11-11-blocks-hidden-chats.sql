-- Messages: seeing the other person's profile, blocking, and deleting a chat
-- just for yourself. Run once, after 2026-11-11-all-schools.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * Blocking: neither of the two can message the other any more, and they
--   no longer see each other in the teacher list. Only the student who
--   blocked can unblock. New accounts need a school access code, so a
--   blocked student can't simply make another account.
-- * Deleting a chat hides it from your own list only. The other student
--   still has it, and it comes back (with its history) as soon as either of
--   you writes again.
-- * Both tables are only used through the functions below; the website's
--   key can't read or change them directly.

create table public.blocks (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index blocks_blocked_id on public.blocks (blocked_id);

create table public.hidden_conversations (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  partner_id  uuid not null references public.profiles (id) on delete cascade,
  hidden_at   timestamptz not null default now(),
  primary key (user_id, partner_id)
);

alter table public.blocks enable row level security;
alter table public.hidden_conversations enable row level security;
revoke all on public.blocks from anon, authenticated;
revoke all on public.hidden_conversations from anon, authenticated;

-- Whether either of the two blocked the other.
create function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = p_a and blocked_id = p_b)
        or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

revoke all on function public.is_blocked_between(uuid, uuid) from public;

-- Same as before, and never between students where one blocked the other.
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

-- Same as before, without teachers you blocked or who blocked you.
create or replace function public.find_teachers()
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
     and not public.is_blocked_between(auth.uid(), p.id)
   order by p.full_name;
$$;

-- The conversation list, now without chats you deleted (until a newer
-- message arrives) and with whether you blocked the other student.
drop function if exists public.my_conversations();

create function public.my_conversations()
returns table (
  partner_id     uuid,
  full_name      text,
  username       text,
  avatar         text,
  last_body      text,
  last_from_me   boolean,
  last_at        timestamptz,
  unread         int,
  can_reply      boolean,
  blocked_by_me  boolean
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
         public.can_message(l.partner),
         exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = l.partner)
    from latest l
    join public.profiles p on p.id = l.partner
   where not exists (
     select 1 from public.hidden_conversations h
      where h.user_id = auth.uid() and h.partner_id = l.partner and h.hidden_at >= l.created_at
   )
   order by l.created_at desc;
$$;

revoke all on function public.my_conversations() from public;
grant execute on function public.my_conversations() to authenticated;

-- Someone's profile, for opening a chat and for the profile window inside
-- it: any teacher, or anyone you already exchanged messages with. Nothing
-- for a student who blocked you. Diplomas and TAMO grades only appear once
-- Mokify verified them, and only their titles (never the files).
drop function if exists public.chat_partner(uuid);

create function public.chat_partner(p_id uuid)
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
       or exists (
         select 1 from public.messages m
          where (m.sender_id = them.id and m.recipient_id = auth.uid())
             or (m.sender_id = auth.uid() and m.recipient_id = them.id)
       )
     );
$$;

revoke all on function public.chat_partner(uuid) from public;
grant execute on function public.chat_partner(uuid) to authenticated;

create function public.block_user(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.blocks (blocker_id, blocked_id)
  select auth.uid(), p.id from public.profiles p
   where p.id = p_id and p.id <> auth.uid()
  on conflict do nothing;
$$;

create function public.unblock_user(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_id;
$$;

-- Hides the chat with p_partner from your list (and marks it read) until a
-- newer message arrives.
create function public.hide_conversation(p_partner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.hidden_conversations (user_id, partner_id, hidden_at)
  select auth.uid(), p.id, now() from public.profiles p
   where p.id = p_partner and p.id <> auth.uid()
  on conflict (user_id, partner_id) do update set hidden_at = excluded.hidden_at;

  update public.messages
     set read_at = now()
   where recipient_id = auth.uid() and sender_id = p_partner and read_at is null;
end;
$$;

revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
revoke all on function public.hide_conversation(uuid) from public;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.hide_conversation(uuid) to authenticated;
