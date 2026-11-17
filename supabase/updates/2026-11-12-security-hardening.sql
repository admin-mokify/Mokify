-- Security hardening. Run once, after 2026-11-11-blocks-hidden-chats.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * is_blocked_between() is only meant to be used inside the other database
--   functions. Supabase lets the website's key call every new function unless
--   told otherwise, so without this anyone could ask "did student A block
--   student B?" for any two accounts.
-- * Message rate limit: at most 20 messages a minute and 300 an hour per
--   student, so one account can't flood a teacher's inbox or fill the database.

revoke all on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;

create index if not exists messages_sender_recent on public.messages (sender_id, created_at desc);

-- Runs as the sending student (not security definer), so it only counts rows
-- that student can see anyway: the messages they sent.
create function public.limit_message_rate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (select count(*) from public.messages
         where sender_id = new.sender_id
           and created_at > now() - interval '1 minute') >= 20
       or (select count(*) from public.messages
            where sender_id = new.sender_id
              and created_at > now() - interval '1 hour') >= 300 then
      raise exception 'Too many messages, try again in a minute';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.limit_message_rate() from public, anon, authenticated;

create trigger limit_message_rate_on_insert
  before insert on public.messages
  for each row
  execute function public.limit_message_rate();
