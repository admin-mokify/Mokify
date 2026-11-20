-- "Kas gali pradėti pokalbį su tavimi?" now starts as "Bet kuris Mokify
-- moksleivis" (anyone can find you by username and write to you), as the
-- owner decided on 2026-11-20. Run once, after
-- 2026-12-03-meeting-videos-any.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * New accounts start with 'everyone'.
-- * Existing accounts still on the old default ('teachers') are switched to
--   'everyone' too. (The site can't tell who picked 'teachers' on purpose;
--   anyone can change it back in Nustatymai.)

alter table public.profiles alter column messages_from set default 'everyone';

update public.profiles set messages_from = 'everyone' where messages_from = 'teachers';
