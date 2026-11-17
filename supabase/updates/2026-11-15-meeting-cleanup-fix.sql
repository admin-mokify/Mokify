-- Fix: inviting to a lesson, proposing a time, and creating or joining a
-- meeting all answered "Nepavyko" once the meetings had been installed for an
-- hour. Their hourly clean-up updated meeting_settings without a "where",
-- which Supabase refuses for requests from the website. Run once, after
-- 2026-11-14-lessons.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.

create or replace function public.meeting_cleanup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.meeting_settings set last_cleanup_at = now() where id;

  delete from public.meeting_signals where created_at < now() - interval '2 minutes';
  delete from public.meeting_actions where at < now() - interval '2 days';

  update public.meeting_rooms set ended_at = expires_at
   where ended_at is null and expires_at <= now();

  delete from public.meeting_rooms m
   where m.ended_at < now() - interval '30 days'
     and not exists (
       select 1 from public.meeting_reports r
        where r.room_id = m.id and r.status <> 'closed'
     );
end;
$$;

revoke all on function public.meeting_cleanup() from public, anon, authenticated;
