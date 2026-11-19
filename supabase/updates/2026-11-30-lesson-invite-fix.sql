-- Fix: a new "lesson now" invitation kept the length of an older one.
-- Run once, after 2026-11-29-message-search.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- Before: if the two students still had an earlier "now" lesson whose call
-- was open (a call stays open up to 3 hours until both are in), a new
-- invitation silently reopened that old lesson, with its old length (e.g.
-- 60 minutes instead of the 15 just chosen).
-- Now:
-- * an earlier lesson that is running (both have been in the call) is
--   still reopened, so two lessons can't overlap;
-- * an earlier lesson nobody started yet, with the same length, is
--   reopened (pressing "invite" twice doesn't make two);
-- * with a different length, the old one is called off and a new one with
--   the chosen length (and its own invitation message) is made.

create or replace function public.lesson_request(p_partner uuid, p_starts_at timestamptz default null, p_duration int default 60)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_gate     text := public.meeting_gate();
  v_teacher  uuid;
  v_student  uuid;
  v_id       uuid;
  v_length   int := coalesce(p_duration, 60);
  v_old      public.lessons;
  v_started  boolean;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  if p_partner is null or not public.can_message(p_partner) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  if exists (select 1 from public.teacher_profiles t where t.id = v_me) then
    v_teacher := v_me;
    v_student := p_partner;
  elsif exists (select 1 from public.teacher_profiles t where t.id = p_partner) then
    v_teacher := p_partner;
    v_student := v_me;
  else
    return jsonb_build_object('ok', false, 'error', 'no_teacher');
  end if;

  if v_length not between 15 and 240 or v_length % 15 <> 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_duration');
  end if;
  if p_starts_at is not null
     and (p_starts_at < now() + interval '5 minutes' or p_starts_at > now() + interval '1 year') then
    return jsonb_build_object('ok', false, 'error', 'bad_time');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(v_me, p_partner)::text || greatest(v_me, p_partner)::text, 0));

  if p_starts_at is null then
    select l.* into v_old
      from public.lessons l
      join public.meeting_rooms m on m.id = l.room_id
     where l.teacher_id in (v_me, p_partner) and l.student_id in (v_me, p_partner)
       and l.starts_at is null and l.status = 'accepted'
       and m.ended_at is null and m.expires_at > now()
     order by l.created_at desc
     limit 1;
    if v_old.id is not null then
      v_started := v_old.began_at is not null or (
        select count(*) = 2 from public.meeting_participants p
         where p.room_id = v_old.room_id and p.user_id in (v_old.teacher_id, v_old.student_id)
           and p.first_admitted_at is not null);
      if v_started or v_old.duration_minutes = v_length then
        return jsonb_build_object('ok', true, 'id', v_old.id, 'again', true);
      end if;
      -- Not started and a different length: call the old one off.
      update public.lessons x set status = 'cancelled', decided_at = now() where x.id = v_old.id;
      update public.meeting_rooms m set ended_at = now() where m.id = v_old.room_id and m.ended_at is null;
      delete from public.meeting_signals s where s.room_id = v_old.room_id;
      perform public.meeting_nudge(public.meeting_present(v_old.room_id));
    end if;
  elsif public.lesson_pending(v_me, p_partner) is not null then
    return jsonb_build_object('ok', false, 'error', 'already', 'id', public.lesson_pending(v_me, p_partner));
  end if;

  if not public.meeting_allow(v_me, 'lesson', interval '1 hour', 20) then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  perform public.meeting_cleanup_if_due();

  insert into public.lessons (teacher_id, student_id, proposed_by, starts_at, status, decided_at, duration_minutes)
  values (v_teacher, v_student, v_me, p_starts_at,
          case when p_starts_at is null then 'accepted' else 'proposed' end,
          case when p_starts_at is null then now() end,
          v_length)
  returning id into v_id;
  if p_starts_at is null then
    perform public.lesson_make_room(v_id);
  end if;

  insert into public.messages (sender_id, recipient_id, body, lesson_id, lesson_event)
  values (v_me, p_partner,
          case when p_starts_at is null then 'Kviečiu į pamoką dabar (' || public.lesson_duration_text(v_length) || ').'
               else 'Siūlau pamoką: ' || public.lesson_time_text(p_starts_at) || ', ' || public.lesson_duration_text(v_length) end,
          v_id,
          case when p_starts_at is null then 'invite' else 'propose' end);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.lesson_request(uuid, timestamptz, int) from public, anon, authenticated;
grant execute on function public.lesson_request(uuid, timestamptz, int) to authenticated;
