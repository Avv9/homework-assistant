-- ============================================================================
-- Demo / seed data for Homework Answer Assistant
-- Run after the migrations in supabase/migrations/.
-- Safe to re-run: uses ON CONFLICT DO NOTHING based on natural keys.
-- ============================================================================

-- Categories ------------------------------------------------------------------
insert into public.categories (slug, name_ar, name_en, requires_specialization, sort_order) values
  ('cci', 'كلية الحوسبة والمعلوماتية', 'College of Computing and Informatics', true, 1),
  ('general', 'المقررات العامة', 'General Courses', false, 2),
  ('islamic', 'المقررات الإسلامية', 'Islamic Courses', false, 3)
on conflict (slug) do nothing;

-- Specializations ---------------------------------------------------------------
insert into public.specializations (category_id, name_ar, name_en, sort_order)
select c.id, v.name_ar, v.name_en, v.sort_order
from public.categories c
cross join (values
  ('تقنية المعلومات', 'Information Technology', 1),
  ('علوم الحاسب', 'Computer Science', 2),
  ('علم البيانات', 'Data Science', 3)
) as v(name_ar, name_en, sort_order)
where c.slug = 'cci'
on conflict do nothing;

-- Academic levels 3-8 for every specialization -----------------------------------
insert into public.levels (specialization_id, number, name_ar, name_en)
select s.id, n, 'المستوى ' || n, 'Level ' || n
from public.specializations s
cross join generate_series(3, 8) as n
on conflict (specialization_id, number) do nothing;

-- Courses (College of Computing and Informatics) ---------------------------------
insert into public.courses (category_id, specialization_id, level_id, code, name_ar, name_en, description_ar, description_en)
select
  c.id,
  s.id,
  l.id,
  v.code,
  v.name_ar,
  v.name_en,
  'وصف مختصر لمقرر ' || v.name_ar || '.',
  'A short description for ' || v.name_en || '.'
from (values
  ('Information Technology', 3, 'IT101', 'مقدمة في تقنية المعلومات', 'Introduction to IT'),
  ('Computer Science',       3, 'CS101', 'أساسيات البرمجة', 'Programming Fundamentals'),
  ('Information Technology', 4, 'IT302', 'شبكات الحاسب', 'Computer Networks'),
  ('Computer Science',       4, 'CS303', 'نظم قواعد البيانات', 'Database Systems'),
  ('Information Technology', 5, 'IT304', 'تقنيات الويب', 'Web Technologies'),
  ('Computer Science',       5, 'CS305', 'نظم التشغيل', 'Operating Systems'),
  ('Computer Science',       4, 'CS204', 'هياكل البيانات', 'Data Structures'),
  ('Computer Science',       4, 'CS205', 'البرمجة كائنية التوجه', 'Object-Oriented Programming'),
  ('Computer Science',       6, 'CS401', 'تحليل وتصميم الخوارزميات', 'Algorithms'),
  ('Computer Science',       7, 'CS501', 'الذكاء الاصطناعي', 'Artificial Intelligence'),
  ('Data Science',           3, 'DS101', 'مقدمة في علم البيانات', 'Introduction to Data Science'),
  ('Data Science',           5, 'DS302', 'تحليل البيانات', 'Data Analysis'),
  ('Data Science',           6, 'DS401', 'أساسيات تعلم الآلة', 'Machine Learning Fundamentals'),
  ('Data Science',           4, 'DS201', 'الإحصاء', 'Statistics')
) as v(spec_en, level_no, code, name_ar, name_en)
join public.specializations s on s.name_en = v.spec_en
join public.categories c on c.id = s.category_id and c.slug = 'cci'
join public.levels l on l.specialization_id = s.id and l.number = v.level_no
on conflict do nothing;

-- General courses ----------------------------------------------------------------
insert into public.courses (category_id, code, name_ar, name_en, description_ar, description_en)
select c.id, v.code, v.name_ar, v.name_en, 'وصف مختصر لمقرر ' || v.name_ar || '.', 'A short description for ' || v.name_en || '.'
from public.categories c
cross join (values
  ('GEN101', 'مهارات اللغة الإنجليزية', 'English Skills'),
  ('GEN102', 'مهارات التواصل', 'Communication Skills')
) as v(code, name_ar, name_en)
where c.slug = 'general'
on conflict do nothing;

-- Islamic courses ------------------------------------------------------------------
insert into public.courses (category_id, code, name_ar, name_en, description_ar, description_en)
select c.id, 'ISL101', 'الثقافة الإسلامية', 'Islamic Culture', 'وصف مختصر لمقرر الثقافة الإسلامية.', 'A short description for Islamic Culture.'
from public.categories c
where c.slug = 'islamic'
on conflict do nothing;

-- Assignments: 3 per course --------------------------------------------------------
insert into public.assignments (course_id, name_ar, name_en, sort_order)
select co.id, v.name_ar, v.name_en, v.sort_order
from public.courses co
cross join (values
  ('الواجب الأول', 'Assignment 1', 1),
  ('الواجب الثاني', 'Assignment 2', 2),
  ('الواجب الثالث', 'Assignment 3', 3)
) as v(name_ar, name_en, sort_order)
on conflict do nothing;

-- A few demo approved questions so search works before any real upload ------------
with target as (
  select a.id as assignment_id, co.id as course_id
  from public.assignments a
  join public.courses co on co.id = a.course_id
  where co.name_en = 'Computer Networks' and a.name_en = 'Assignment 2'
  limit 1
), inserted_q as (
  insert into public.extracted_questions (course_id, assignment_id, question_number, question_text, normalized_text, confidence, published)
  select course_id, assignment_id, 1,
    'What is the difference between TCP and UDP protocols?',
    'what is the difference between tcp and udp protocols',
    0.95, true
  from target
  returning id
)
insert into public.answers (question_id, answer_text)
select id,
  'TCP (Transmission Control Protocol) is connection-oriented, reliable, and guarantees ordered delivery using acknowledgments and retransmission. UDP (User Datagram Protocol) is connectionless, faster, and does not guarantee delivery or order, which makes it suitable for real-time applications such as video streaming and online gaming.'
from inserted_q;

with target as (
  select a.id as assignment_id, co.id as course_id
  from public.assignments a
  join public.courses co on co.id = a.course_id
  where co.name_en = 'Database Systems' and a.name_en = 'Assignment 1'
  limit 1
), inserted_q as (
  insert into public.extracted_questions (course_id, assignment_id, question_number, question_text, normalized_text, confidence, published)
  select course_id, assignment_id, 1,
    'Explain the concept of normalization in relational databases.',
    'explain the concept of normalization in relational databases',
    0.92, true
  from target
  returning id
)
insert into public.answers (question_id, answer_text)
select id,
  'Normalization is the process of organizing tables to reduce data redundancy and improve data integrity. It involves applying a series of normal forms (1NF, 2NF, 3NF, BCNF) which progressively eliminate repeating groups, partial dependencies, and transitive dependencies.'
from inserted_q;
