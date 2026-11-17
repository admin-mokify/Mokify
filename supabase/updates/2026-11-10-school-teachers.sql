-- The "find a teacher" page (mokytojai.html): a signed-in student sees the
-- other students from their own school who signed up to teach. Run once,
-- after the earlier files in this folder:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.
--
-- Profiles stay private (each student can still read only their own row).
-- This function hands out just what the teacher list shows: name, username,
-- picture, description, class, subjects, levels and how many documents Mokify
-- verified. Never email addresses or the documents themselves. It answers
-- only for students whose school subscription is running, and only about
-- their own school.

create function public.school_teachers()
returns table (
  id                 uuid,
  full_name          text,
  username           text,
  avatar             text,
  bio                text,
  grade              smallint,
  subjects           text[],
  levels             text[],
  verified_documents int
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.username, p.avatar, p.bio, p.grade, t.subjects, t.levels,
         (select count(*)::int
            from public.teacher_documents d
           where d.teacher_id = t.id and d.status = 'verified')
    from public.teacher_profiles t
    join public.profiles p on p.id = t.id
    join public.profiles me on me.id = auth.uid()
   where p.school_id = me.school_id
     and p.id <> me.id
     and public.has_active_access()
   order by p.full_name;
$$;

revoke all on function public.school_teachers() from public;
grant execute on function public.school_teachers() to authenticated;
