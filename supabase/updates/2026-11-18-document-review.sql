-- Checking teachers' diplomas and TAMO grades on the website
-- (tikrinimas.html) instead of in the Supabase dashboard. Run once, after
-- 2026-11-17-lesson-changes-notifications.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
-- The result at the bottom lists the reviewers; if it is empty, the account
-- @boomroob didn't exist yet (create it, then run the last section again).
--
-- * Only students listed in public.reviewers may open the review page's data
--   and the uploaded files. Nobody can add themselves: the list can only be
--   changed here, in the SQL editor:
--     insert into public.reviewers (user_id)
--       select id from public.profiles where lower(username) = 'someone';
--     delete from public.reviewers
--      where user_id = (select id from public.profiles where lower(username) = 'someone');
-- * A reviewer approves or rejects a document, optionally with a reason the
--   student sees. A reviewer can't decide on their own documents.
-- * Every decision is also written to public.document_reviews (who, when,
--   what), which only Mokify can read.
-- * The student gets a notification on the website when a document of theirs
--   is checked; reviewers get one when new documents are waiting.

-- ---------------------------------------------------------------------------
-- Reviewers
-- ---------------------------------------------------------------------------

create table public.reviewers (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  added_at  timestamptz not null default now()
);

-- Nobody reads or changes this from the website; only the functions below.
alter table public.reviewers enable row level security;
revoke all on public.reviewers from anon, authenticated;

-- Whether the signed-in student is a reviewer (the account page shows a link
-- to the review page if so). Answers only about oneself.
create function public.is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.reviewers where user_id = auth.uid());
$$;

revoke all on function public.is_reviewer() from public, anon, authenticated;
grant execute on function public.is_reviewer() to authenticated;

-- ---------------------------------------------------------------------------
-- The reason a student is shown, and the history of decisions
-- ---------------------------------------------------------------------------

-- Students already read their own rows (the "Read own teacher documents"
-- policy); they can't write these columns.
alter table public.teacher_documents
  add column review_note text check (char_length(review_note) between 1 and 300);

create table public.document_reviews (
  id           bigint generated always as identity primary key,
  document_id  uuid not null,
  teacher_id   uuid not null,
  reviewer_id  uuid references public.profiles (id) on delete set null,
  status       text not null check (status in ('verified', 'rejected')),
  note         text,
  created_at   timestamptz not null default now()
);

alter table public.document_reviews enable row level security;
revoke all on public.document_reviews from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The review page's data
-- ---------------------------------------------------------------------------

-- Documents with one status ('pending', 'verified' or 'rejected'), with who
-- uploaded them, plus how many there are of each.
-- { ok, counts: { pending, verified, rejected }, items: [...] }
create function public.review_queue(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
begin
  if v_me is null or not exists (select 1 from public.reviewers where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_status is null or p_status not in ('pending', 'verified', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;

  return jsonb_build_object(
    'ok', true,
    'counts', (
      select jsonb_build_object(
               'pending', count(*) filter (where status = 'pending'),
               'verified', count(*) filter (where status = 'verified'),
               'rejected', count(*) filter (where status = 'rejected'))
        from public.teacher_documents
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'kind', q.kind, 'title', q.title, 'path', q.storage_path,
               'status', q.status, 'note', q.review_note,
               'uploaded_at', q.created_at, 'reviewed_at', q.reviewed_at,
               'teacher', q.teacher_id, 'name', q.full_name, 'username', q.username,
               'grade', q.grade, 'school', q.school, 'subjects', q.subjects, 'levels', q.levels,
               'own', q.teacher_id = v_me
             ) order by q.sort_at), '[]'::jsonb)
        from (
          select d.*, p.full_name, p.username, p.grade, s.name as school, t.subjects, t.levels,
                 -- Waiting: oldest first. Checked: newest decision first.
                 case when d.status = 'pending' then extract(epoch from d.created_at)
                      else -extract(epoch from d.reviewed_at) end as sort_at
            from public.teacher_documents d
            join public.teacher_profiles t on t.id = d.teacher_id
            join public.profiles p on p.id = d.teacher_id
            join public.schools s on s.id = p.school_id
           where d.status = p_status
           order by sort_at
           limit 200
        ) q
    )
  );
end;
$$;

revoke all on function public.review_queue(text) from public, anon, authenticated;
grant execute on function public.review_queue(text) to authenticated;

-- Approves ('verified') or rejects ('rejected') one document. A decision can
-- be changed later the same way. p_note is the reason shown to the student
-- (optional; at most 300 characters).
create function public.review_decide(p_document uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_doc   public.teacher_documents;
begin
  if v_me is null or not exists (select 1 from public.reviewers where user_id = v_me) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_status is null or p_status not in ('verified', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;
  if char_length(v_note) > 300 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;

  select * into v_doc from public.teacher_documents where id = p_document for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_doc.teacher_id = v_me then
    return jsonb_build_object('ok', false, 'error', 'own');
  end if;

  update public.teacher_documents
     set status = p_status, review_note = v_note, reviewed_at = now()
   where id = p_document;

  insert into public.document_reviews (document_id, teacher_id, reviewer_id, status, note)
  values (p_document, v_doc.teacher_id, v_me, p_status, v_note);

  return jsonb_build_object('ok', true, 'status', p_status, 'note', v_note);
end;
$$;

revoke all on function public.review_decide(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_decide(uuid, text, text) to authenticated;

-- Reviewers may open every uploaded diploma and grades file (read only).
create policy "Reviewers read teacher documents" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'teacher-documents'
    -- (Through the function: the website's role can't read the list itself.)
    and public.is_reviewer()
  );

-- ---------------------------------------------------------------------------
-- Notifications: the same as before, plus
--   documents     the student's own documents checked since p_since
--   review_new    for reviewers: documents uploaded since p_since and waiting
--   review_waiting for reviewers: all documents waiting
-- ---------------------------------------------------------------------------

create or replace function public.my_notifications(p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me        uuid := auth.uid();
  v_reviewer  boolean;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'signed_out');
  end if;
  v_reviewer := exists (select 1 from public.reviewers where user_id = v_me);

  perform public.lesson_settle(l.id)
     from public.lessons l
    where v_me in (l.teacher_id, l.student_id)
      and l.status = 'accepted' and not l.ended_late
      and l.starts_at between now() - interval '1 day' and now() - interval '15 minutes';

  return jsonb_build_object(
    'ok', true,
    'now', now(),
    'unread', (select count(*)::int from public.messages m where m.recipient_id = v_me and m.read_at is null),
    'unread_new', (select count(*)::int from public.messages m
                    where m.recipient_id = v_me and m.read_at is null and m.deleted_at is null
                      and (p_since is null or m.created_at > p_since)),
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'from', q.sender_id, 'name', q.full_name, 'body', q.body,
               'event', q.lesson_event, 'lesson', q.lesson_id, 'at', q.created_at, 'read', q.read
             ) order by q.created_at), '[]'::jsonb)
        from (
          select m.id, m.sender_id, p.full_name, left(m.body, 160) as body, m.lesson_event, m.lesson_id,
                 m.created_at, m.read_at is not null as read
            from public.messages m
            join public.profiles p on p.id = m.sender_id
           where p_since is not null and m.recipient_id = v_me and m.deleted_at is null
             and m.created_at > p_since
           order by m.created_at desc
           limit 20
        ) q
    ),
    'events', (
      with mine as (
        select l.*,
               case when l.teacher_id = v_me then l.student_id else l.teacher_id end as partner,
               (select p.first_admitted_at from public.meeting_participants p
                 where p.room_id = l.room_id and p.user_id = v_me) as me_at,
               (select p.first_admitted_at from public.meeting_participants p
                 where p.room_id = l.room_id and p.user_id = case when l.teacher_id = v_me then l.student_id else l.teacher_id end) as them_at,
               (select m.ended_at from public.meeting_rooms m where m.id = l.room_id) as room_ended
          from public.lessons l
         where v_me in (l.teacher_id, l.student_id)
           and l.status = 'accepted'
           and coalesce(l.starts_at, l.created_at) between now() - interval '1 day' and now() + interval '1 day'
      ),
      ev as (
        select id, partner, 'open' as kind, starts_at - interval '10 minutes' as at from mine
         where starts_at is not null and not ended_late and room_ended is null and me_at is null
           and now() >= starts_at - interval '10 minutes' and now() < starts_at + interval '15 minutes'
        union all
        select id, partner, 'late5', starts_at + interval '5 minutes' from mine
         where starts_at is not null and not ended_late and room_ended is null and me_at is null
           and now() >= starts_at + interval '5 minutes'
        union all
        select id, partner, 'late10', starts_at + interval '10 minutes' from mine
         where starts_at is not null and not ended_late and room_ended is null and me_at is null
           and now() >= starts_at + interval '10 minutes'
        union all
        select id, partner, 'joined', them_at from mine
         where them_at is not null and not ended_late and room_ended is null
        union all
        select id, partner, 'late_ended', ended_late_at from mine
         where ended_late and (late_user is null or late_user = v_me)
        union all
        select id, partner, 'partner_late', ended_late_at from mine
         where ended_late and late_user = partner
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', ev.kind, 'lesson', ev.id, 'at', ev.at, 'partner', ev.partner, 'name', p.full_name
             ) order by ev.at), '[]'::jsonb)
        from ev join public.profiles p on p.id = ev.partner
    ),
    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id, 'kind', d.kind, 'title', d.title, 'status', d.status,
               'note', d.review_note, 'at', d.reviewed_at
             ) order by d.reviewed_at), '[]'::jsonb)
        from public.teacher_documents d
       where p_since is not null and d.teacher_id = v_me
         and d.status <> 'pending' and d.reviewed_at > p_since
    ),
    'review_new', case when v_reviewer and p_since is not null then (
      select count(*)::int from public.teacher_documents d
       where d.status = 'pending' and d.created_at > p_since and d.teacher_id <> v_me
    ) else 0 end,
    'review_waiting', case when v_reviewer then (
      select count(*)::int from public.teacher_documents d
       where d.status = 'pending' and d.teacher_id <> v_me
    ) else 0 end
  );
end;
$$;

revoke all on function public.my_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.my_notifications(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- The first reviewer: @boomroob, shown as "Admin".
-- ---------------------------------------------------------------------------

update public.profiles set full_name = 'Admin' where lower(username) = 'boomroob';

insert into public.reviewers (user_id)
select id from public.profiles where lower(username) = 'boomroob'
on conflict (user_id) do nothing;

select p.username, p.full_name
  from public.reviewers r
  join public.profiles p on p.id = r.user_id;
