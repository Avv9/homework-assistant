-- ============================================================================
-- Homework Answer Assistant — Initial schema
-- Run with: supabase db push   (or paste into the Supabase SQL editor)
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists vector;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type file_status as enum ('uploaded', 'processing', 'needs_review', 'published', 'failed');
create type category_slug as enum ('cci', 'general', 'islamic');

-- ---------------------------------------------------------------------------
-- Admins (pre-approved only — no public registration)
-- ---------------------------------------------------------------------------
create table public.admins (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default uuid_generate_v4(),
  slug category_slug not null unique,
  name_ar text not null,
  name_en text not null,
  requires_specialization boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Specializations (College of Computing and Informatics only, currently)
-- ---------------------------------------------------------------------------
create table public.specializations (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid not null references public.categories (id) on delete cascade,
  name_ar text not null,
  name_en text not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_specializations_category on public.specializations (category_id);

-- ---------------------------------------------------------------------------
-- Academic levels (3-8), scoped to a specialization
-- ---------------------------------------------------------------------------
create table public.levels (
  id uuid primary key default uuid_generate_v4(),
  specialization_id uuid not null references public.specializations (id) on delete cascade,
  number int not null check (number between 1 and 12),
  name_ar text not null,
  name_en text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (specialization_id, number)
);
create index idx_levels_specialization on public.levels (specialization_id);

-- ---------------------------------------------------------------------------
-- Courses
-- ---------------------------------------------------------------------------
create table public.courses (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid not null references public.categories (id) on delete restrict,
  specialization_id uuid references public.specializations (id) on delete set null,
  level_id uuid references public.levels (id) on delete set null,
  code text,
  name_ar text not null,
  name_en text not null,
  description_ar text,
  description_en text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_courses_category on public.courses (category_id);
create index idx_courses_specialization on public.courses (specialization_id);
create index idx_courses_level on public.courses (level_id);

-- ---------------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------------
create table public.assignments (
  id uuid primary key default uuid_generate_v4(),
  course_id uuid not null references public.courses (id) on delete cascade,
  name_ar text not null,
  name_en text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_assignments_course on public.assignments (course_id);

-- ---------------------------------------------------------------------------
-- Source files (owner-uploaded PDFs, stored privately — never public)
-- ---------------------------------------------------------------------------
create table public.source_files (
  id uuid primary key default uuid_generate_v4(),
  course_id uuid not null references public.courses (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  size_bytes bigint not null default 0,
  page_count int,
  status file_status not null default 'uploaded',
  processing_error text,
  uploaded_by uuid references public.admins (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_source_files_assignment on public.source_files (course_id, assignment_id);

-- ---------------------------------------------------------------------------
-- Extracted questions (owner-approved Q/A pairs derived from source files)
-- ---------------------------------------------------------------------------
create table public.extracted_questions (
  id uuid primary key default uuid_generate_v4(),
  source_file_id uuid references public.source_files (id) on delete set null,
  course_id uuid not null references public.courses (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  question_number int,
  question_text text not null,
  normalized_text text not null,
  page_number int,
  confidence numeric(4,3) not null default 0,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_extracted_questions_scope on public.extracted_questions (course_id, assignment_id, published);
create index idx_extracted_questions_trgm on public.extracted_questions using gin (normalized_text gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Answers (1:1 with extracted_questions — kept separate for clarity/auditing)
-- ---------------------------------------------------------------------------
create table public.answers (
  id uuid primary key default uuid_generate_v4(),
  question_id uuid not null references public.extracted_questions (id) on delete cascade unique,
  answer_text text not null,
  edited_by uuid references public.admins (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Question embeddings (pgvector — used for semantic search)
-- Dimension 1536 matches OpenAI text-embedding-3-small; adjust if you switch models.
-- ---------------------------------------------------------------------------
create table public.question_embeddings (
  question_id uuid primary key references public.extracted_questions (id) on delete cascade,
  embedding vector(1536) not null,
  model text not null default 'text-embedding-3-small',
  created_at timestamptz not null default now()
);
create index idx_question_embeddings_ivfflat
  on public.question_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ---------------------------------------------------------------------------
-- AI-generated answers awaiting owner review
-- ---------------------------------------------------------------------------
create table public.ai_generated_answers (
  id uuid primary key default uuid_generate_v4(),
  question_text text not null,
  answer_text text not null,
  category_id uuid references public.categories (id) on delete set null,
  specialization_id uuid references public.specializations (id) on delete set null,
  level_id uuid references public.levels (id) on delete set null,
  course_id uuid not null references public.courses (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  source_context text,
  reviewed boolean not null default false,
  approved boolean not null default false,
  approved_question_id uuid references public.extracted_questions (id) on delete set null,
  requester_ip_hash text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index idx_ai_answers_pending on public.ai_generated_answers (reviewed) where reviewed = false;
create index idx_ai_answers_scope on public.ai_generated_answers (course_id, assignment_id);

-- ---------------------------------------------------------------------------
-- Processing jobs (tracks async PDF/OCR/AI extraction pipeline runs)
-- ---------------------------------------------------------------------------
create table public.processing_jobs (
  id uuid primary key default uuid_generate_v4(),
  source_file_id uuid not null references public.source_files (id) on delete cascade,
  status file_status not null default 'processing',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  log jsonb not null default '[]'::jsonb
);
create index idx_processing_jobs_file on public.processing_jobs (source_file_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_categories_updated before update on public.categories
  for each row execute function public.set_updated_at();
create trigger trg_specializations_updated before update on public.specializations
  for each row execute function public.set_updated_at();
create trigger trg_courses_updated before update on public.courses
  for each row execute function public.set_updated_at();
create trigger trg_assignments_updated before update on public.assignments
  for each row execute function public.set_updated_at();
create trigger trg_source_files_updated before update on public.source_files
  for each row execute function public.set_updated_at();
create trigger trg_extracted_questions_updated before update on public.extracted_questions
  for each row execute function public.set_updated_at();
create trigger trg_answers_updated before update on public.answers
  for each row execute function public.set_updated_at();
