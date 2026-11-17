-- Teacher registration: a signed-in student can also sign up to teach, by
-- choosing subjects and optionally adding diplomas and their grades from TAMO.
-- Run once, after the earlier files in this folder:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- Diplomas and grades are files in a private Storage bucket. Each student can
-- only see and change their own. They all start as 'pending'; only Mokify can
-- mark them 'verified' or 'rejected' (SQL editor / server code), e.g.:
--   update public.teacher_documents
--      set status = 'verified', reviewed_at = now()
--    where id = '<document id>';

-- ---------------------------------------------------------------------------
-- Teacher profiles: one per student who signed up to teach.
-- ---------------------------------------------------------------------------

create table public.teacher_profiles (
  id          uuid primary key references public.profiles (id) on delete cascade,
  -- Keys of the subjects listed in TEACHER_SUBJECTS in assets/js/main.js.
  subjects    text[] not null check (
                cardinality(subjects) between 1 and 17
                and subjects <@ array[
                  'matematika', 'lietuviu', 'anglu', 'vokieciu', 'prancuzu', 'rusu',
                  'fizika', 'chemija', 'biologija', 'istorija', 'geografija',
                  'informatika', 'ekonomika', 'pilietiskumas', 'technologijos',
                  'daile', 'muzika'
                ]::text[]
              ),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger teacher_profiles_touch
  before update on public.teacher_profiles
  for each row
  execute function public.touch_updated_at();

-- A signed-in student can read their own teacher profile, create it and change
-- its subjects later. Students of a school whose subscription ended can still
-- read it, but not create or change it (see public.has_active_access).
alter table public.teacher_profiles enable row level security;
revoke all on public.teacher_profiles from anon, authenticated;
grant select on public.teacher_profiles to authenticated;
grant insert (id, subjects) on public.teacher_profiles to authenticated;
grant update (subjects) on public.teacher_profiles to authenticated;

create policy "Read own teacher profile" on public.teacher_profiles
  for select to authenticated
  using (auth.uid() = id);

create policy "Create own teacher profile" on public.teacher_profiles
  for insert to authenticated
  with check (auth.uid() = id and public.has_active_access());

create policy "Update own teacher profile" on public.teacher_profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id and public.has_active_access());

-- ---------------------------------------------------------------------------
-- Diplomas and TAMO grades.
-- ---------------------------------------------------------------------------

create table public.teacher_documents (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references public.teacher_profiles (id) on delete cascade,
  kind          text not null check (kind in ('diploma', 'grades')),
  title         text not null check (char_length(title) between 1 and 120),
  -- "<teacher id>/<random id>.<ext>" inside the teacher-documents bucket.
  storage_path  text not null unique check (
                  storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'
                  and split_part(storage_path, '/', 1) = teacher_id::text
                ),
  status        text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index teacher_documents_teacher_id on public.teacher_documents (teacher_id);

-- Only one grades file per teacher; uploading a new one replaces the old.
create unique index teacher_documents_one_grades
  on public.teacher_documents (teacher_id) where kind = 'grades';

-- A student can list, add and remove their own documents, but never change
-- one (so status stays as Mokify set it: a replaced file is a new 'pending' row).
alter table public.teacher_documents enable row level security;
revoke all on public.teacher_documents from anon, authenticated;
grant select, delete on public.teacher_documents to authenticated;
grant insert (teacher_id, kind, title, storage_path) on public.teacher_documents to authenticated;

create policy "Read own teacher documents" on public.teacher_documents
  for select to authenticated
  using (auth.uid() = teacher_id);

create policy "Add own teacher documents" on public.teacher_documents
  for insert to authenticated
  with check (auth.uid() = teacher_id and public.has_active_access());

create policy "Remove own teacher documents" on public.teacher_documents
  for delete to authenticated
  using (auth.uid() = teacher_id);

-- ---------------------------------------------------------------------------
-- File storage: private bucket, one folder per teacher (named by their id).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'teacher-documents', 'teacher-documents', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
);

create policy "Upload own teacher documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'teacher-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.teacher_profiles t where t.id = auth.uid())
    and public.has_active_access()
  );

create policy "Read own teacher documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'teacher-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Delete own teacher documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'teacher-documents' and (storage.foldername(name))[1] = auth.uid()::text);
