-- Teachers: drop the subjects Dailė, Technologijos, Muzika and Pilietiškumo
-- pagrindai, and ask which classes they will teach. Run once, after
-- 2026-10-10-teachers.sql:
-- Supabase: SQL Editor -> New query -> paste this whole file -> Run.

-- Teachers who already chose a dropped subject keep their other subjects.
-- A teacher who had only dropped subjects can't be fixed automatically, so the
-- update stops and names them; choose new subjects for them first.
do $$
declare
  v_stuck text;
begin
  select string_agg(id::text, ', ') into v_stuck
    from public.teacher_profiles
   where subjects <@ array['pilietiskumas', 'technologijos', 'daile', 'muzika']::text[];
  if v_stuck is not null then
    raise exception 'These teachers only teach dropped subjects: %', v_stuck;
  end if;
end;
$$;

alter table public.teacher_profiles drop constraint teacher_profiles_subjects_check;

update public.teacher_profiles
   set subjects = array(
         select s from unnest(subjects) s
          where s <> all (array['pilietiskumas', 'technologijos', 'daile', 'muzika'])
       )
 where subjects && array['pilietiskumas', 'technologijos', 'daile', 'muzika']::text[];

-- Keys of TEACHER_SUBJECTS in assets/js/main.js.
alter table public.teacher_profiles add constraint teacher_profiles_subjects_check check (
  cardinality(subjects) between 1 and 13
  and subjects <@ array[
    'matematika', 'lietuviu', 'anglu', 'vokieciu', 'prancuzu', 'rusu',
    'fizika', 'chemija', 'biologija', 'istorija', 'geografija',
    'informatika', 'ekonomika'
  ]::text[]
);

-- Which classes they will teach; keys of TEACHER_LEVELS in assets/js/main.js.
-- Teachers who signed up before this get all three; they can change it.
alter table public.teacher_profiles
  add column levels text[] not null default array['5-8', '9-10', '11-12']
  check (
    cardinality(levels) between 1 and 3
    and levels <@ array['5-8', '9-10', '11-12']::text[]
  );
alter table public.teacher_profiles alter column levels drop default;

grant insert (levels) on public.teacher_profiles to authenticated;
grant update (levels) on public.teacher_profiles to authenticated;
