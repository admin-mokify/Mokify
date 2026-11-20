-- YouTube videos in meetings and lessons: the website's server
-- (functions/api/youtube.js) asks this before checking a video with YouTube.
-- Run once, after 2026-12-01-lesson-sound.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- Only a student who is inside the meeting right now may have videos
-- checked, at most 60 times an hour, so nobody can use up Mokify's free
-- daily YouTube allowance. Nothing about the video is stored.

create function public.meeting_video_ticket(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  r       public.meeting_rooms;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  r := public.meeting_find(p_code);
  if r.id is null or r.ended_at is not null or not exists (
       select 1 from public.meeting_participants x
        where x.room_id = r.id and x.user_id = v_me and x.status = 'admitted'
     ) then
    return jsonb_build_object('ok', false, 'error', 'not_inside');
  end if;
  if not public.meeting_allow(v_me, 'video', interval '1 hour', 60) then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.meeting_video_ticket(text) from public, anon, authenticated;
grant execute on function public.meeting_video_ticket(text) to authenticated;
