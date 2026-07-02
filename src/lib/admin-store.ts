import {
  categories as seedCategories,
  specializations as seedSpecializations,
  levels as seedLevels,
  courses as seedCourses,
  assignments as seedAssignments,
  demoQuestions as seedQuestions,
} from "./demo-data";
import type {
  Category,
  Specialization,
  Level,
  Course,
  Assignment,
  SourceFile,
  ExtractedQuestion,
  AiGeneratedAnswer,
} from "./types";

/**
 * In-memory data store used so the Admin Dashboard is fully functional in local/demo
 * environments without a configured Supabase project. State resets on server restart.
 * In production (NEXT_PUBLIC_SUPABASE_URL configured), API routes should instead read
 * and write through `src/lib/supabase/server.ts` against the tables defined in
 * `supabase/migrations`. The shape mirrors the database schema 1:1 to make that swap
 * straightforward.
 */
class AdminStore {
  categories: Category[] = JSON.parse(JSON.stringify(seedCategories));
  specializations: Specialization[] = JSON.parse(JSON.stringify(seedSpecializations));
  levels: Level[] = JSON.parse(JSON.stringify(seedLevels));
  courses: Course[] = JSON.parse(JSON.stringify(seedCourses));
  assignments: Assignment[] = JSON.parse(JSON.stringify(seedAssignments));
  files: SourceFile[] = [];
  extractedQuestions: ExtractedQuestion[] = JSON.parse(JSON.stringify(seedQuestions));
  aiAnswers: AiGeneratedAnswer[] = [];
}

const globalForStore = globalThis as unknown as { __adminStore?: AdminStore };

export const store = globalForStore.__adminStore ?? new AdminStore();
if (!globalForStore.__adminStore) globalForStore.__adminStore = store;

export function genId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
