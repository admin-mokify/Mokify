-- Teachers can deactivate their teacher account from the account page. Their
-- student account stays; the teacher profile and its documents are deleted
-- (documents go with it through "on delete cascade"), so teaching again means
-- signing up on tapti-mokytoju.html again. The website removes the files from
-- the teacher-documents bucket itself (the "Delete own teacher documents"
-- storage policy already allows that). Run once, after the earlier files in
-- this folder:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.

grant delete on public.teacher_profiles to authenticated;

create policy "Delete own teacher profile" on public.teacher_profiles
  for delete to authenticated
  using (auth.uid() = id);
