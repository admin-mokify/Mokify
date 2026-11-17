-- Deleting your own messages, and calling off an agreed lesson only when
-- both agree. Run once, after 2026-11-15-meeting-cleanup-fix.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- * A student can delete a message they sent. It disappears for both, and
--   the chat shows "Žinutė ištrinta" in its place. A copy is kept for 30
--   days in deleted_messages, which only Mokify can read, so a deleted
--   message can still be checked if someone complains about it:
--     select * from public.deleted_messages order by deleted_at desc;
--   Invitations to lessons and proposed times can't be deleted (they are
--   called off instead).
-- * Two students can have only one lesson time on the table at once: either
--   one proposal waiting for an answer, or one agreed lesson that hasn't
--   happened yet. (Inviting to a lesson right now always works.)
-- * An agreed lesson is called off only when both agree: one asks, the
--   other agrees or refuses in the chat. A proposal nobody answered yet can
--   still be taken back by whoever made it.

-- ---------------------------------------------------------------------------
-- Deleting messages
-- ---------------------------------------------------------------------------

alter table public.messages add column deleted_at timestamptz;

-- What a lesson message is about, so the chat can show the right card:
-- 'invite' (a lesson right now), 'propose' (a proposed time) or 'cancel'
-- (asking to call an agreed lesson off). Set by the database only.
alter table public.messages add column lesson_event text
  check (lesson_event in ('invite', 'propose', 'cancel'));

create table public.deleted_messages (
  message_id    uuid primary key,
  sender_id     uuid not null,
  recipient_id  uuid not null,
  body          text not null,
  sent_at       timestamptz not null,
  deleted_at    timestamptz not null default now()
);

alter table public.deleted_messages enable row level security;
revoke all on public.deleted_messages from public, anon, authenticated;

create function public.delete_message(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  m     public.messages;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'signed_out');
  end if;
  select * into m from public.messages x
   where x.id = p_id and x.sender_id = v_me and x.lesson_id is null and x.deleted_at is null
   for update;
  if m.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.deleted_messages (message_id, sender_id, recipient_id, body, sent_at)
  values (m.id, m.sender_id, m.recipient_id, m.body, m.created_at);
  update public.messages x set body = 'Žinutė ištrinta', deleted_at = now() where x.id = m.id;

  -- Copies older than 30 days go.
  delete from public.deleted_messages d where d.deleted_at < now() - interval '30 days';
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.delete_message(uuid) from public, anon, authenticated;
grant execute on function public.delete_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Lessons: one time on the table at once, and calling off by agreement
-- ---------------------------------------------------------------------------

alter table public.lessons
  add column cancel_requested_by uuid references public.profiles (id) on delete set null,
  add column cancel_requested_at timestamptz;

-- The lesson time the two are dealing with right now, if any: a proposal
-- still waiting for an answer, or an agreed lesson that isn't over yet.
create function public.lesson_pending(p_a uuid, p_b uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
    from public.lessons l
    left join public.meeting_rooms m on m.id = l.room_id
   where l.teacher_id in (p_a, p_b) and l.student_id in (p_a, p_b)
     and l.starts_at is not null
     and (
       (l.status = 'proposed' and l.starts_at > now())
       or (l.status = 'accepted'
           and case when m.id is null then now() < l.starts_at + interval '3 hours'
                    else m.ended_at is null and m.expires_at > now() end)
     )
   order by l.starts_at
   limit 1;
$$;

revoke all on function public.lesson_pending(uuid, uuid) from public, anon, authenticated;

-- Same as before, and: no new time while another one is on the table.
create or replace function public.lesson_request(p_partner uuid, p_starts_at timestamptz default null)
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

  if p_starts_at is not null
     and (p_starts_at < now() + interval '5 minutes' or p_starts_at > now() + interval '1 year') then
    return jsonb_build_object('ok', false, 'error', 'bad_time');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(v_me, p_partner)::text || greatest(v_me, p_partner)::text, 0));

  if p_starts_at is null then
    select l.id into v_id
      from public.lessons l
      join public.meeting_rooms m on m.id = l.room_id
     where l.teacher_id in (v_me, p_partner) and l.student_id in (v_me, p_partner)
       and l.starts_at is null and l.status = 'accepted'
       and m.ended_at is null and m.expires_at > now()
     order by l.created_at desc
     limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'id', v_id, 'again', true);
    end if;
  elsif public.lesson_pending(v_me, p_partner) is not null then
    return jsonb_build_object('ok', false, 'error', 'already', 'id', public.lesson_pending(v_me, p_partner));
  end if;

  if not public.meeting_allow(v_me, 'lesson', interval '1 hour', 20) then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  perform public.meeting_cleanup_if_due();

  insert into public.lessons (teacher_id, student_id, proposed_by, starts_at, status, decided_at)
  values (v_teacher, v_student, v_me, p_starts_at,
          case when p_starts_at is null then 'accepted' else 'proposed' end,
          case when p_starts_at is null then now() end)
  returning id into v_id;
  if p_starts_at is null then
    perform public.lesson_make_room(v_id);
  end if;

  insert into public.messages (sender_id, recipient_id, body, lesson_id, lesson_event)
  values (v_me, p_partner,
          case when p_starts_at is null then 'Kviečiu į pamoką dabar.'
               else 'Siūlau pamoką: ' || public.lesson_time_text(p_starts_at) || '.' end,
          v_id,
          case when p_starts_at is null then 'invite' else 'propose' end);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Same as before, and: a proposal can't be agreed while another lesson
-- between the two is already agreed (only possible for older proposals).
create or replace function public.lesson_answer(p_lesson uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gate  text := public.meeting_gate();
  l       public.lessons;
begin
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'error', v_gate);
  end if;
  select * into l from public.lessons x
   where x.id = p_lesson and v_me in (x.teacher_id, x.student_id) for update;
  if l.id is null or l.proposed_by = v_me or l.status <> 'proposed' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if coalesce(p_accept, false) and l.starts_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'over');
  end if;
  if coalesce(p_accept, false) and public.is_blocked_between(l.teacher_id, l.student_id) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;
  if coalesce(p_accept, false) and exists (
       select 1 from public.lessons o
        where o.id = public.lesson_pending(l.teacher_id, l.student_id) and o.status = 'accepted'
     ) then
    return jsonb_build_object('ok', false, 'error', 'already');
  end if;

  update public.lessons x
     set status = case when coalesce(p_accept, false) then 'accepted' else 'declined' end, decided_at = now()
   where x.id = l.id;

  if public.can_message(l.proposed_by) then
    insert into public.messages (sender_id, recipient_id, body)
    values (v_me, l.proposed_by,
            case when coalesce(p_accept, false) then 'Sutinku. Pamoka: ' else 'Šis laikas man netinka: ' end
            || public.lesson_time_text(l.starts_at) || '.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- A proposal: whoever made it takes it back.
-- An agreed lesson: asks the other student to call it off (a card with two
-- buttons in their chat). If they had already asked, this agrees instead.
create or replace function public.lesson_cancel(p_lesson uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_other  uuid;
  l        public.lessons;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'signed_out');
  end if;
  select * into l from public.lessons x
   where x.id = p_lesson and v_me in (x.teacher_id, x.student_id) for update;
  if l.id is null or l.starts_at is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_other := case when l.teacher_id = v_me then l.student_id else l.teacher_id end;

  if l.status = 'proposed' then
    if l.proposed_by <> v_me then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    update public.lessons x set status = 'cancelled', decided_at = now() where x.id = l.id;
    if l.starts_at > now() and public.can_message(v_other) then
      insert into public.messages (sender_id, recipient_id, body)
      values (v_me, v_other, 'Atsiimu pasiūlymą: ' || public.lesson_time_text(l.starts_at) || '.');
    end if;
    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;

  if l.status <> 'accepted' or l.starts_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- They asked first: this is the agreement.
  if l.cancel_requested_by = v_other then
    return public.lesson_cancel_answer(p_lesson, true);
  end if;
  if l.cancel_requested_by = v_me then
    return jsonb_build_object('ok', true, 'requested', true);
  end if;

  -- Someone who can't be written to any more can't answer either; the
  -- lesson can't take place anyway, so it is simply called off.
  if not public.can_message(v_other) then
    update public.lessons x set status = 'cancelled', decided_at = now() where x.id = l.id;
    update public.meeting_rooms m set ended_at = now() where m.id = l.room_id and m.ended_at is null;
    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;

  update public.lessons x set cancel_requested_by = v_me, cancel_requested_at = now() where x.id = l.id;
  insert into public.messages (sender_id, recipient_id, body, lesson_id, lesson_event)
  values (v_me, v_other, 'Prašau atšaukti pamoką: ' || public.lesson_time_text(l.starts_at) || '.', l.id, 'cancel');
  return jsonb_build_object('ok', true, 'requested', true);
end;
$$;

-- The other student agrees (true) or refuses (false) to call a lesson off.
create function public.lesson_cancel_answer(p_lesson uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  l     public.lessons;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'signed_out');
  end if;
  select * into l from public.lessons x
   where x.id = p_lesson and v_me in (x.teacher_id, x.student_id) for update;
  if l.id is null or l.status <> 'accepted' or l.cancel_requested_by is null or l.cancel_requested_by = v_me then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if coalesce(p_accept, false) then
    update public.lessons x set status = 'cancelled', decided_at = now() where x.id = l.id;
    update public.meeting_rooms m set ended_at = now() where m.id = l.room_id and m.ended_at is null;
  else
    update public.lessons x set cancel_requested_by = null, cancel_requested_at = null where x.id = l.id;
  end if;

  if public.can_message(l.cancel_requested_by) then
    insert into public.messages (sender_id, recipient_id, body)
    values (v_me, l.cancel_requested_by,
            case when coalesce(p_accept, false) then 'Sutinku. Pamoka atšaukta: ' else 'Nesutinku atšaukti pamokos: ' end
            || public.lesson_time_text(l.starts_at) || '.');
  end if;
  return jsonb_build_object('ok', true, 'cancelled', coalesce(p_accept, false));
end;
$$;

revoke all on function public.lesson_cancel_answer(uuid, boolean) from public, anon, authenticated;
grant execute on function public.lesson_cancel_answer(uuid, boolean) to authenticated;

-- Same as before, plus who asked to call a lesson off ('me', 'them' or
-- nothing) and which lesson time is on the table now (pending).
create or replace function public.lesson_list(p_partner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'signed_out');
  end if;
  return jsonb_build_object(
    'ok', true,
    'can_request', public.meeting_gate() is null and public.can_message(p_partner) and exists (
      select 1 from public.teacher_profiles t where t.id in (v_me, p_partner)
    ),
    'pending', public.lesson_pending(v_me, p_partner),
    'lessons', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'starts_at', q.starts_at, 'by_me', q.proposed_by = v_me,
               'i_teach', q.teacher_id = v_me, 'state', q.state,
               'cancel', case when q.cancel_requested_by = v_me then 'me'
                              when q.cancel_requested_by is not null then 'them' end
             ) order by q.created_at desc), '[]'::jsonb)
        from (
          select l.id, l.starts_at, l.proposed_by, l.teacher_id, l.created_at, l.cancel_requested_by,
                 case
                   when l.status = 'proposed' and l.starts_at <= now() then 'expired'
                   when l.status <> 'accepted' then l.status
                   when m.id is not null and (m.ended_at is not null or m.expires_at <= now()) then 'over'
                   when m.id is null and now() > coalesce(l.starts_at, l.created_at) + interval '3 hours' then 'over'
                   when l.starts_at is null or now() >= l.starts_at - interval '10 minutes' then 'open'
                   else 'upcoming'
                 end as state
            from public.lessons l
            left join public.meeting_rooms m on m.id = l.room_id
           where l.teacher_id in (v_me, p_partner) and l.student_id in (v_me, p_partner)
             and (p_partner <> v_me)
           order by l.created_at desc
           limit 100
        ) q
    )
  );
end;
$$;
