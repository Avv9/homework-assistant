-- ============================================================================
-- Hybrid search function: combines trigram similarity with pgvector cosine
-- distance, scoped to a single course + assignment. Called from the server
-- (service-role) inside /api/search after computing a query embedding.
-- ============================================================================

create or replace function public.match_questions(
  p_course_id uuid,
  p_assignment_id uuid,
  p_query_normalized text,
  p_query_embedding vector(1536),
  p_match_count int default 5
)
returns table (
  question_id uuid,
  question_text text,
  answer_text text,
  trigram_score real,
  semantic_score real,
  combined_score real
)
language sql stable as $$
  select
    q.id as question_id,
    q.question_text,
    a.answer_text,
    similarity(q.normalized_text, p_query_normalized) as trigram_score,
    1 - (e.embedding <=> p_query_embedding) as semantic_score,
    (0.4 * similarity(q.normalized_text, p_query_normalized)
      + 0.6 * (1 - (e.embedding <=> p_query_embedding))) as combined_score
  from public.extracted_questions q
  join public.answers a on a.question_id = q.id
  left join public.question_embeddings e on e.question_id = q.id
  where q.course_id = p_course_id
    and q.assignment_id = p_assignment_id
    and q.published = true
  order by combined_score desc nulls last
  limit p_match_count;
$$;

comment on function public.match_questions is
  'Hybrid (trigram + pgvector) search restricted to one course/assignment scope. '
  'The caller applies SEARCH_CONFIDENCE_THRESHOLD to combined_score to decide '
  'whether to use the approved answer or fall back to AI generation.';
