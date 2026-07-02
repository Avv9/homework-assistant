-- ============================================================================
-- Row Level Security policies
-- ============================================================================

alter table public.admins enable row level security;
alter table public.categories enable row level security;
alter table public.specializations enable row level security;
alter table public.levels enable row level security;
alter table public.courses enable row level security;
alter table public.assignments enable row level security;
alter table public.source_files enable row level security;
alter table public.extracted_questions enable row level security;
alter table public.answers enable row level security;
alter table public.question_embeddings enable row level security;
alter table public.ai_generated_answers enable row level security;
alter table public.processing_jobs enable row level security;

-- Helper: is the current request from an authenticated admin?
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select exists (select 1 from public.admins where id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Public (anon) read access — browsing structure only, no file/answer secrets
-- ---------------------------------------------------------------------------
create policy "public can read active categories" on public.categories
  for select using (is_active = true or public.is_admin());

create policy "public can read active specializations" on public.specializations
  for select using (is_active = true or public.is_admin());

create policy "public can read active levels" on public.levels
  for select using (is_active = true or public.is_admin());

create policy "public can read active courses" on public.courses
  for select using (is_active = true or public.is_admin());

create policy "public can read active assignments" on public.assignments
  for select using (is_active = true or public.is_admin());

-- Published, approved questions/answers are readable so the server-side search
-- function can use them. Direct anon SELECT is still scoped to published rows
-- only — never unpublished/needs_review content, and never source_files rows.
create policy "public can read published questions" on public.extracted_questions
  for select using (published = true or public.is_admin());

create policy "public can read answers for published questions" on public.answers
  for select using (
    exists (
      select 1 from public.extracted_questions q
      where q.id = answers.question_id and (q.published = true or public.is_admin())
    )
  );

-- ---------------------------------------------------------------------------
-- Admin-only tables / write access
-- ---------------------------------------------------------------------------
create policy "admins manage own row" on public.admins
  for select using (id = auth.uid());

create policy "admins write categories" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admins write specializations" on public.specializations
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admins write levels" on public.levels
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admins write courses" on public.courses
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admins write assignments" on public.assignments
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admins write extracted_questions" on public.extracted_questions
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admins write answers" on public.answers
  for all using (public.is_admin()) with check (public.is_admin());

-- source_files, embeddings, ai_generated_answers and processing_jobs are
-- never exposed to anon users — only admins (via the dashboard) and the
-- server (via the service-role key, which bypasses RLS) can touch them.
create policy "admins manage source_files" on public.source_files
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage embeddings" on public.question_embeddings
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage ai_generated_answers" on public.ai_generated_answers
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage processing_jobs" on public.processing_jobs
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- Storage: private bucket for owner-uploaded solution PDFs
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('course-files', 'course-files', false)
on conflict (id) do nothing;

create policy "admins read course files" on storage.objects
  for select using (bucket_id = 'course-files' and public.is_admin());
create policy "admins upload course files" on storage.objects
  for insert with check (bucket_id = 'course-files' and public.is_admin());
create policy "admins update course files" on storage.objects
  for update using (bucket_id = 'course-files' and public.is_admin());
create policy "admins delete course files" on storage.objects
  for delete using (bucket_id = 'course-files' and public.is_admin());

-- No policy grants students/anon access to the 'course-files' bucket. All
-- student-facing reads must go through the server API (service-role key),
-- which only ever returns approved answer text — never the original file.
