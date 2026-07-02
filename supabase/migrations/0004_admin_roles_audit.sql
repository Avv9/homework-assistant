-- ============================================================================
-- Migration 0004 — Admin roles, audit log, tightened RLS
-- Run after 0001–0003.
-- ============================================================================

-- Admin role enum
create type admin_role as enum ('owner', 'editor', 'reviewer', 'viewer');

-- Drop old minimal admins table and recreate with roles
drop table if exists public.admins cascade;

create table public.admins (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        admin_role not null default 'viewer',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_admins_updated before update on public.admins
  for each row execute function public.set_updated_at();

-- Audit log
create table public.audit_log (
  id          uuid primary key default uuid_generate_v4(),
  admin_id    uuid references public.admins (id) on delete set null,
  admin_email text not null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
create index idx_audit_log_created on public.audit_log (created_at desc);
create index idx_audit_log_admin on public.audit_log (admin_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.admins enable row level security;
alter table public.audit_log enable row level security;

-- Helper returning the current user's role (or null if not in admins table)
create or replace function public.current_admin_role()
returns text language sql stable security definer as $$
  select role::text from public.admins where id = auth.uid() and is_active = true limit 1;
$$;

-- Admins can only read their own record unless they're an owner
create policy "admins read own or owner reads all" on public.admins
  for select using (
    id = auth.uid()
    or public.current_admin_role() = 'owner'
  );

create policy "owners manage admins" on public.admins
  for all using (public.current_admin_role() = 'owner')
  with check (public.current_admin_role() = 'owner');

create policy "owners and reviewers read audit log" on public.audit_log
  for select using (
    public.current_admin_role() in ('owner', 'reviewer', 'editor', 'viewer')
  );

create policy "owners insert audit log" on public.audit_log
  for insert with check (public.current_admin_role() is not null);

-- ── Role-gated policies for other tables ─────────────────────────────────────

-- Categories — only owner can mutate
drop policy if exists "admins write categories" on public.categories;
create policy "editor+ write categories" on public.categories
  for all using (public.current_admin_role() in ('owner', 'editor'))
  with check (public.current_admin_role() in ('owner', 'editor'));

-- Specializations / Levels / Courses / Assignments — editor+
drop policy if exists "admins write specializations" on public.specializations;
create policy "editor+ write specializations" on public.specializations
  for all using (public.current_admin_role() in ('owner', 'editor'))
  with check (public.current_admin_role() in ('owner', 'editor'));

drop policy if exists "admins write levels" on public.levels;
create policy "editor+ write levels" on public.levels
  for all using (public.current_admin_role() in ('owner', 'editor'))
  with check (public.current_admin_role() in ('owner', 'editor'));

drop policy if exists "admins write courses" on public.courses;
create policy "editor+ write courses" on public.courses
  for all using (public.current_admin_role() in ('owner', 'editor'))
  with check (public.current_admin_role() in ('owner', 'editor'));

drop policy if exists "admins write assignments" on public.assignments;
create policy "editor+ write assignments" on public.assignments
  for all using (public.current_admin_role() in ('owner', 'editor'))
  with check (public.current_admin_role() in ('owner', 'editor'));

-- Files — editor+
drop policy if exists "admins manage source_files" on public.source_files;
create policy "editor+ manage source_files" on public.source_files
  for all using (public.current_admin_role() in ('owner', 'editor'))
  with check (public.current_admin_role() in ('owner', 'editor'));

-- Extracted questions — reviewer+
drop policy if exists "admins write extracted_questions" on public.extracted_questions;
create policy "reviewer+ write extracted_questions" on public.extracted_questions
  for all using (public.current_admin_role() in ('owner', 'editor', 'reviewer'))
  with check (public.current_admin_role() in ('owner', 'editor', 'reviewer'));

drop policy if exists "admins write answers" on public.answers;
create policy "reviewer+ write answers" on public.answers
  for all using (public.current_admin_role() in ('owner', 'editor', 'reviewer'))
  with check (public.current_admin_role() in ('owner', 'editor', 'reviewer'));

-- AI generated answers — reviewer+
drop policy if exists "admins manage ai_generated_answers" on public.ai_generated_answers;
create policy "reviewer+ manage ai answers" on public.ai_generated_answers
  for all using (public.current_admin_role() in ('owner', 'editor', 'reviewer'))
  with check (public.current_admin_role() in ('owner', 'editor', 'reviewer'));

-- Embeddings — editor+
drop policy if exists "admins manage embeddings" on public.question_embeddings;
create policy "editor+ manage embeddings" on public.question_embeddings
  for all using (public.current_admin_role() in ('owner', 'editor'))
  with check (public.current_admin_role() in ('owner', 'editor'));

-- Processing jobs — editor+
drop policy if exists "admins manage processing_jobs" on public.processing_jobs;
create policy "editor+ manage processing_jobs" on public.processing_jobs
  for all using (public.current_admin_role() in ('owner', 'editor'))
  with check (public.current_admin_role() in ('owner', 'editor'));

-- Storage — editors can upload, reviewers can read for review only
drop policy if exists "admins read course files" on storage.objects;
drop policy if exists "admins upload course files" on storage.objects;
drop policy if exists "admins update course files" on storage.objects;
drop policy if exists "admins delete course files" on storage.objects;

create policy "reviewer+ read course files" on storage.objects
  for select using (bucket_id = 'course-files' and public.current_admin_role() is not null);
create policy "editor+ upload course files" on storage.objects
  for insert with check (bucket_id = 'course-files' and public.current_admin_role() in ('owner', 'editor'));
create policy "editor+ update course files" on storage.objects
  for update using (bucket_id = 'course-files' and public.current_admin_role() in ('owner', 'editor'));
create policy "editor+ delete course files" on storage.objects
  for delete using (bucket_id = 'course-files' and public.current_admin_role() in ('owner', 'editor'));
