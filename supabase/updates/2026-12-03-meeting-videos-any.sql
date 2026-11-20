-- Videos in meetings (susitikimai.html) may be any YouTube video; lessons
-- (pamoka.html, with points and social hours) keep the educational-only rule.
-- Run once, after 2026-12-02-meeting-videos.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- Same as before, and the answer says whether the call is a lesson, so the
-- website's server (functions/api/youtube.js) knows which rule applies.
-- Until this file is run, every call is treated as a lesson (the stricter
-- rule).

create or replace function public.meeting_video_ticket(p_code text)
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
  return jsonb_build_object('ok', true, 'lesson', r.kind = 'lesson');
end;
$$;

revoke all on function public.meeting_video_ticket(text) from public, anon, authenticated;
grant execute on function public.meeting_video_ticket(text) to authenticated;
