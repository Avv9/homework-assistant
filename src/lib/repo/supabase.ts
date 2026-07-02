import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminRepo } from "./interface";
import type {
  Category, Specialization, Level, Course, Assignment,
  SourceFile, ExtractedQuestion, AiGeneratedAnswer, Admin, AdminRole, AuditLogEntry,
} from "../types";
import {
  mapCategory, mapSpecialization, mapLevel, mapCourse, mapAssignment,
  mapSourceFile, mapExtractedQuestion, mapAiAnswer, mapAdmin, mapAuditEntry,
} from "./mappers";
import { normalize } from "../search";
import { config } from "../config";

function err(label: string, e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  throw new Error(`[SupabaseRepo:${label}] ${msg}`);
}

export class SupabaseRepo implements AdminRepo {
  constructor(private readonly db: SupabaseClient) {}

  // ── Public ──────────────────────────────────────────────────────────────────
  async getCategories(): Promise<Category[]> {
    const { data, error } = await this.db.from("categories").select("*").eq("is_active", true).order("sort_order");
    if (error) err("getCategories", error);
    return (data ?? []).map(mapCategory);
  }
  async getCategoryBySlug(slug: string): Promise<Category | null> {
    const { data, error } = await this.db.from("categories").select("*").eq("slug", slug).eq("is_active", true).maybeSingle();
    if (error) err("getCategoryBySlug", error);
    return data ? mapCategory(data) : null;
  }
  async getSpecializations(categoryId: string): Promise<Specialization[]> {
    const { data, error } = await this.db.from("specializations").select("*").eq("category_id", categoryId).eq("is_active", true).order("sort_order");
    if (error) err("getSpecializations", error);
    return (data ?? []).map(mapSpecialization);
  }
  async getSpecializationById(id: string): Promise<Specialization | null> {
    const { data, error } = await this.db.from("specializations").select("*").eq("id", id).maybeSingle();
    if (error) err("getSpecializationById", error);
    return data ? mapSpecialization(data) : null;
  }
  async getLevels(specializationId: string): Promise<Level[]> {
    const { data, error } = await this.db.from("levels").select("*").eq("specialization_id", specializationId).eq("is_active", true).order("number");
    if (error) err("getLevels", error);
    return (data ?? []).map(mapLevel);
  }
  async getLevelById(id: string): Promise<Level | null> {
    const { data, error } = await this.db.from("levels").select("*").eq("id", id).maybeSingle();
    if (error) err("getLevelById", error);
    return data ? mapLevel(data) : null;
  }
  async getCourses(opts: { categoryId?: string; specializationId?: string; levelId?: string }): Promise<Course[]> {
    let q = this.db.from("courses").select("*").eq("is_active", true);
    if (opts.categoryId) q = q.eq("category_id", opts.categoryId);
    if (opts.specializationId) q = q.eq("specialization_id", opts.specializationId);
    if (opts.levelId) q = q.eq("level_id", opts.levelId);
    const { data, error } = await q.order("name_en");
    if (error) err("getCourses", error);
    return (data ?? []).map(mapCourse);
  }
  async getCourseById(id: string): Promise<Course | null> {
    const { data, error } = await this.db.from("courses").select("*").eq("id", id).maybeSingle();
    if (error) err("getCourseById", error);
    return data ? mapCourse(data) : null;
  }
  async getAssignments(courseId: string): Promise<Assignment[]> {
    const { data, error } = await this.db.from("assignments").select("*").eq("course_id", courseId).eq("is_active", true).order("sort_order");
    if (error) err("getAssignments", error);
    return (data ?? []).map(mapAssignment);
  }
  async getAssignmentById(id: string): Promise<Assignment | null> {
    const { data, error } = await this.db.from("assignments").select("*").eq("id", id).maybeSingle();
    if (error) err("getAssignmentById", error);
    return data ? mapAssignment(data) : null;
  }

  async searchQuestions(courseId: string, assignmentId: string, queryText: string, queryEmbedding: number[] | null) {
    const norm = normalize(queryText);

    // Try semantic search via SQL function if embedding available
    if (queryEmbedding && config.embeddingEnabled) {
      const { data, error } = await this.db.rpc("match_questions", {
        p_course_id: courseId, p_assignment_id: assignmentId,
        p_query_normalized: norm, p_query_embedding: queryEmbedding,
        p_match_count: 5,
      });
      if (!error && data && data.length > 0) {
        return (data as Array<{
          question_id: string; question_text: string; answer_text: string; combined_score: number;
        }>).map(row => ({
          question: { id: row.question_id, questionText: row.question_text, answerText: row.answer_text,
            normalizedText: norm, sourceFileId: "", courseId, assignmentId, confidence: row.combined_score, published: true },
          score: row.combined_score,
        }));
      }
    }

    // Trigram fallback via pg_trgm similarity (needs pg_trgm extension)
    const { data, error } = await this.db
      .from("extracted_questions")
      .select("*, answers!inner(answer_text)")
      .eq("course_id", courseId)
      .eq("assignment_id", assignmentId)
      .eq("published", true)
      .textSearch("normalized_text", norm.split(" ").join(" & "), { type: "plain", config: "simple" })
      .limit(5);

    if (!error && data && data.length > 0) {
      return data.map(r => ({ question: mapExtractedQuestion(r), score: 0.8 }));
    }

    // Normalized-text fallback with ILIKE
    const { data: fallback } = await this.db
      .from("extracted_questions")
      .select("*, answers!inner(answer_text)")
      .eq("course_id", courseId)
      .eq("assignment_id", assignmentId)
      .eq("published", true)
      .ilike("normalized_text", `%${norm.slice(0, 60)}%`)
      .limit(5);

    return (fallback ?? []).map(r => ({ question: mapExtractedQuestion(r), score: 0.7 }));
  }

  async saveAiAnswer(answer: Omit<AiGeneratedAnswer, "id" | "createdAt" | "reviewed" | "approved">): Promise<void> {
    await this.db.from("ai_generated_answers").insert({
      question_text: answer.questionText, answer_text: answer.answerText,
      category_id: answer.categoryId, specialization_id: answer.specializationId ?? null,
      level_id: answer.levelId ?? null, course_id: answer.courseId, assignment_id: answer.assignmentId,
    });
  }

  // ── Admin stats ─────────────────────────────────────────────────────────────
  async getStats() {
    const [courses, assignments, files, approved, pending] = await Promise.all([
      this.db.from("courses").select("id", { count: "exact", head: true }),
      this.db.from("assignments").select("id", { count: "exact", head: true }),
      this.db.from("source_files").select("id", { count: "exact", head: true }),
      this.db.from("extracted_questions").select("id", { count: "exact", head: true }).eq("published", true),
      this.db.from("ai_generated_answers").select("id", { count: "exact", head: true }).eq("reviewed", false),
    ]);
    return {
      courses: courses.count ?? 0, assignments: assignments.count ?? 0, files: files.count ?? 0,
      approvedQuestions: approved.count ?? 0, pendingAiAnswers: pending.count ?? 0,
    };
  }

  // ── Categories ───────────────────────────────────────────────────────────────
  async createCategory(data: Omit<Category, "id">): Promise<Category> {
    const { data: r, error } = await this.db.from("categories").insert({
      slug: data.slug, name_ar: data.nameAr, name_en: data.nameEn,
      requires_specialization: data.requiresSpecialization, is_active: data.isActive, sort_order: data.sortOrder,
    }).select().single();
    if (error) err("createCategory", error);
    return mapCategory(r);
  }
  async updateCategory(id: string, data: Partial<Category>): Promise<Category> {
    const { data: r, error } = await this.db.from("categories").update({
      ...(data.nameAr !== undefined && { name_ar: data.nameAr }),
      ...(data.nameEn !== undefined && { name_en: data.nameEn }),
      ...(data.slug !== undefined && { slug: data.slug }),
      ...(data.isActive !== undefined && { is_active: data.isActive }),
      ...(data.sortOrder !== undefined && { sort_order: data.sortOrder }),
      ...(data.requiresSpecialization !== undefined && { requires_specialization: data.requiresSpecialization }),
    }).eq("id", id).select().single();
    if (error) err("updateCategory", error);
    return mapCategory(r);
  }
  async deleteCategory(id: string): Promise<void> {
    const { error } = await this.db.from("categories").delete().eq("id", id);
    if (error) err("deleteCategory", error);
  }

  // ── Specializations ──────────────────────────────────────────────────────────
  async createSpecialization(data: Omit<Specialization, "id">): Promise<Specialization> {
    const { data: r, error } = await this.db.from("specializations").insert({ category_id: data.categoryId, name_ar: data.nameAr, name_en: data.nameEn, is_active: data.isActive, sort_order: data.sortOrder }).select().single();
    if (error) err("createSpecialization", error);
    return mapSpecialization(r);
  }
  async updateSpecialization(id: string, data: Partial<Specialization>): Promise<Specialization> {
    const { data: r, error } = await this.db.from("specializations").update({
      ...(data.nameAr !== undefined && { name_ar: data.nameAr }),
      ...(data.nameEn !== undefined && { name_en: data.nameEn }),
      ...(data.isActive !== undefined && { is_active: data.isActive }),
      ...(data.sortOrder !== undefined && { sort_order: data.sortOrder }),
    }).eq("id", id).select().single();
    if (error) err("updateSpecialization", error);
    return mapSpecialization(r);
  }
  async deleteSpecialization(id: string): Promise<void> {
    const { error } = await this.db.from("specializations").delete().eq("id", id);
    if (error) err("deleteSpecialization", error);
  }

  // ── Levels ────────────────────────────────────────────────────────────────────
  async createLevel(data: Omit<Level, "id">): Promise<Level> {
    const { data: r, error } = await this.db.from("levels").insert({ specialization_id: data.specializationId, number: data.number, name_ar: data.nameAr, name_en: data.nameEn, is_active: data.isActive }).select().single();
    if (error) err("createLevel", error);
    return mapLevel(r);
  }
  async updateLevel(id: string, data: Partial<Level>): Promise<Level> {
    const { data: r, error } = await this.db.from("levels").update({
      ...(data.nameAr !== undefined && { name_ar: data.nameAr }),
      ...(data.nameEn !== undefined && { name_en: data.nameEn }),
      ...(data.isActive !== undefined && { is_active: data.isActive }),
      ...(data.number !== undefined && { number: data.number }),
    }).eq("id", id).select().single();
    if (error) err("updateLevel", error);
    return mapLevel(r);
  }
  async deleteLevel(id: string): Promise<void> {
    const { error } = await this.db.from("levels").delete().eq("id", id);
    if (error) err("deleteLevel", error);
  }

  // ── Courses ───────────────────────────────────────────────────────────────────
  async createCourse(data: Omit<Course, "id">): Promise<Course> {
    const { data: r, error } = await this.db.from("courses").insert({
      category_id: data.categoryId, specialization_id: data.specializationId, level_id: data.levelId,
      code: data.code, name_ar: data.nameAr, name_en: data.nameEn,
      description_ar: data.descriptionAr, description_en: data.descriptionEn, is_active: data.isActive,
    }).select().single();
    if (error) err("createCourse", error);
    return mapCourse(r);
  }
  async updateCourse(id: string, data: Partial<Course>): Promise<Course> {
    const patch: Record<string, unknown> = {};
    if (data.nameAr !== undefined) patch.name_ar = data.nameAr;
    if (data.nameEn !== undefined) patch.name_en = data.nameEn;
    if (data.code !== undefined) patch.code = data.code;
    if (data.categoryId !== undefined) patch.category_id = data.categoryId;
    if (data.specializationId !== undefined) patch.specialization_id = data.specializationId;
    if (data.levelId !== undefined) patch.level_id = data.levelId;
    if (data.descriptionAr !== undefined) patch.description_ar = data.descriptionAr;
    if (data.descriptionEn !== undefined) patch.description_en = data.descriptionEn;
    if (data.isActive !== undefined) patch.is_active = data.isActive;
    const { data: r, error } = await this.db.from("courses").update(patch).eq("id", id).select().single();
    if (error) err("updateCourse", error);
    return mapCourse(r);
  }
  async deleteCourse(id: string): Promise<void> {
    const { error } = await this.db.from("courses").delete().eq("id", id);
    if (error) err("deleteCourse", error);
  }

  // ── Assignments ───────────────────────────────────────────────────────────────
  async createAssignment(data: Omit<Assignment, "id" | "sortOrder">): Promise<Assignment> {
    const { count } = await this.db.from("assignments").select("id", { count: "exact", head: true }).eq("course_id", data.courseId);
    const { data: r, error } = await this.db.from("assignments").insert({
      course_id: data.courseId, name_ar: data.nameAr, name_en: data.nameEn,
      sort_order: (count ?? 0) + 1, is_active: data.isActive,
    }).select().single();
    if (error) err("createAssignment", error);
    return mapAssignment(r);
  }
  async updateAssignment(id: string, data: Partial<Assignment>): Promise<Assignment> {
    const patch: Record<string, unknown> = {};
    if (data.nameAr !== undefined) patch.name_ar = data.nameAr;
    if (data.nameEn !== undefined) patch.name_en = data.nameEn;
    if (data.sortOrder !== undefined) patch.sort_order = data.sortOrder;
    if (data.isActive !== undefined) patch.is_active = data.isActive;
    const { data: r, error } = await this.db.from("assignments").update(patch).eq("id", id).select().single();
    if (error) err("updateAssignment", error);
    return mapAssignment(r);
  }
  async deleteAssignment(id: string): Promise<void> {
    const { error } = await this.db.from("assignments").delete().eq("id", id);
    if (error) err("deleteAssignment", error);
  }

  // ── Files ─────────────────────────────────────────────────────────────────────
  async getFiles(filter?: { courseId?: string; assignmentId?: string }): Promise<SourceFile[]> {
    let q = this.db.from("source_files").select("*").order("uploaded_at", { ascending: false });
    if (filter?.courseId) q = q.eq("course_id", filter.courseId);
    if (filter?.assignmentId) q = q.eq("assignment_id", filter.assignmentId);
    const { data, error } = await q;
    if (error) err("getFiles", error);
    return (data ?? []).map(mapSourceFile);
  }
  async createFile(data: Omit<SourceFile, "id" | "uploadedAt">): Promise<SourceFile> {
    const { data: r, error } = await this.db.from("source_files").insert({
      course_id: data.courseId, assignment_id: data.assignmentId, storage_path: data.storagePath,
      file_name: data.fileName, size_bytes: data.sizeBytes, page_count: data.pageCount ?? null,
      status: data.status,
    }).select().single();
    if (error) err("createFile", error);
    return mapSourceFile(r);
  }
  async updateFile(id: string, data: Partial<SourceFile>): Promise<SourceFile> {
    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.pageCount !== undefined) patch.page_count = data.pageCount;
    if (data.processingError !== undefined) patch.processing_error = data.processingError;
    const { data: r, error } = await this.db.from("source_files").update(patch).eq("id", id).select().single();
    if (error) err("updateFile", error);
    return mapSourceFile(r);
  }
  async deleteFile(id: string): Promise<void> {
    // get storage path first
    const { data: f } = await this.db.from("source_files").select("storage_path").eq("id", id).single();
    if (f?.storage_path) await this.db.storage.from("course-files").remove([f.storage_path]);
    const { error } = await this.db.from("source_files").delete().eq("id", id);
    if (error) err("deleteFile", error);
  }

  // ── Extracted questions ───────────────────────────────────────────────────────
  async getExtractedQuestions(filter?: { sourceFileId?: string; courseId?: string; assignmentId?: string }): Promise<ExtractedQuestion[]> {
    let q = this.db.from("extracted_questions").select("*, answers(answer_text)");
    if (filter?.sourceFileId) q = q.eq("source_file_id", filter.sourceFileId);
    if (filter?.courseId) q = q.eq("course_id", filter.courseId);
    if (filter?.assignmentId) q = q.eq("assignment_id", filter.assignmentId);
    const { data, error } = await q.order("question_number");
    if (error) err("getExtractedQuestions", error);
    return (data ?? []).map(mapExtractedQuestion);
  }
  async createExtractedQuestion(data: Omit<ExtractedQuestion, "id">): Promise<ExtractedQuestion> {
    const { data: q, error } = await this.db.from("extracted_questions").insert({
      source_file_id: data.sourceFileId, course_id: data.courseId, assignment_id: data.assignmentId,
      question_number: data.questionNumber ?? null, question_text: data.questionText,
      normalized_text: data.normalizedText, page_number: data.pageNumber ?? null,
      confidence: data.confidence, published: data.published,
    }).select().single();
    if (error) err("createExtractedQuestion", error);
    // create answer row
    if (data.answerText) {
      await this.db.from("answers").insert({ question_id: q.id, answer_text: data.answerText });
    }
    return { ...mapExtractedQuestion(q), answerText: data.answerText };
  }
  async updateExtractedQuestion(id: string, data: Partial<ExtractedQuestion>): Promise<ExtractedQuestion> {
    const patch: Record<string, unknown> = {};
    if (data.questionText !== undefined) { patch.question_text = data.questionText; patch.normalized_text = normalize(data.questionText); }
    if (data.published !== undefined) patch.published = data.published;
    if (data.confidence !== undefined) patch.confidence = data.confidence;
    const { data: r, error } = await this.db.from("extracted_questions").update(patch).eq("id", id).select().single();
    if (error) err("updateExtractedQuestion", error);
    if (data.answerText !== undefined) {
      await this.db.from("answers").upsert({ question_id: id, answer_text: data.answerText }, { onConflict: "question_id" });
    }
    const { data: ans } = await this.db.from("answers").select("answer_text").eq("question_id", id).single();
    return { ...mapExtractedQuestion(r), answerText: ans?.answer_text ?? "" };
  }
  async deleteExtractedQuestion(id: string): Promise<void> {
    const { error } = await this.db.from("extracted_questions").delete().eq("id", id);
    if (error) err("deleteExtractedQuestion", error);
  }
  async publishQuestionsForFile(sourceFileId: string): Promise<void> {
    const { error } = await this.db.from("extracted_questions").update({ published: true }).eq("source_file_id", sourceFileId);
    if (error) err("publishQuestionsForFile", error);
    await this.db.from("source_files").update({ status: "published" }).eq("id", sourceFileId);
  }

  // ── AI answers ────────────────────────────────────────────────────────────────
  async getAiAnswers(filter?: { reviewed?: boolean }): Promise<AiGeneratedAnswer[]> {
    let q = this.db.from("ai_generated_answers").select("*").order("created_at", { ascending: false });
    if (filter?.reviewed !== undefined) q = q.eq("reviewed", filter.reviewed);
    const { data, error } = await q;
    if (error) err("getAiAnswers", error);
    return (data ?? []).map(mapAiAnswer);
  }
  async updateAiAnswer(id: string, data: Partial<AiGeneratedAnswer>): Promise<AiGeneratedAnswer> {
    const patch: Record<string, unknown> = {};
    if (data.answerText !== undefined) patch.answer_text = data.answerText;
    if (data.reviewed !== undefined) patch.reviewed = data.reviewed;
    if (data.approved !== undefined) patch.approved = data.approved;
    const { data: r, error } = await this.db.from("ai_generated_answers").update(patch).eq("id", id).select().single();
    if (error) err("updateAiAnswer", error);
    return mapAiAnswer(r);
  }
  async deleteAiAnswer(id: string): Promise<void> {
    const { error } = await this.db.from("ai_generated_answers").delete().eq("id", id);
    if (error) err("deleteAiAnswer", error);
  }
  async approveAiAnswer(id: string, editedAnswer?: string): Promise<void> {
    const { data: ai } = await this.db.from("ai_generated_answers").select("*").eq("id", id).single();
    if (!ai) return;
    const answerText = editedAnswer ?? ai.answer_text;
    await this.db.from("ai_generated_answers").update({ reviewed: true, approved: true, answer_text: answerText, reviewed_at: new Date().toISOString() }).eq("id", id);
    // promote to extracted_questions + answers
    const { data: q } = await this.db.from("extracted_questions").insert({
      source_file_id: null, course_id: ai.course_id, assignment_id: ai.assignment_id,
      question_text: ai.question_text, normalized_text: normalize(ai.question_text),
      confidence: 1, published: true,
    }).select().single();
    if (q) await this.db.from("answers").insert({ question_id: q.id, answer_text: answerText });
  }

  // ── Admins ─────────────────────────────────────────────────────────────────────
  async getAdmins(): Promise<Admin[]> {
    const { data, error } = await this.db.from("admins").select("*").order("created_at");
    if (error) err("getAdmins", error);
    return (data ?? []).map(mapAdmin);
  }
  async createAdmin(data: { email: string; role: AdminRole; fullName?: string }): Promise<Admin> {
    const { data: r, error } = await this.db.from("admins").insert({ email: data.email, role: data.role, full_name: data.fullName ?? null, is_active: true }).select().single();
    if (error) err("createAdmin", error);
    return mapAdmin(r);
  }
  async updateAdmin(id: string, data: Partial<Pick<Admin, "role" | "isActive" | "fullName">>): Promise<Admin> {
    const patch: Record<string, unknown> = {};
    if (data.role !== undefined) patch.role = data.role;
    if (data.isActive !== undefined) patch.is_active = data.isActive;
    if (data.fullName !== undefined) patch.full_name = data.fullName;
    const { data: r, error } = await this.db.from("admins").update(patch).eq("id", id).select().single();
    if (error) err("updateAdmin", error);
    return mapAdmin(r);
  }
  async deleteAdmin(id: string): Promise<void> {
    const { error } = await this.db.from("admins").delete().eq("id", id);
    if (error) err("deleteAdmin", error);
  }

  // ── Audit log ─────────────────────────────────────────────────────────────────
  async getAuditLog(limit = 100): Promise<AuditLogEntry[]> {
    const { data, error } = await this.db.from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) err("getAuditLog", error);
    return (data ?? []).map(mapAuditEntry);
  }
  async addAuditEntry(entry: Omit<AuditLogEntry, "id" | "createdAt">): Promise<void> {
    await this.db.from("audit_log").insert({
      admin_id: entry.adminId, admin_email: entry.adminEmail, action: entry.action,
      entity_type: entry.entityType, entity_id: entry.entityId ?? null, metadata: entry.metadata ?? null,
    });
  }

  // ── Embeddings ────────────────────────────────────────────────────────────────
  async storeEmbedding(questionId: string, embedding: number[]): Promise<void> {
    await this.db.from("question_embeddings").upsert({ question_id: questionId, embedding: JSON.stringify(embedding), model: config.embeddingModel }, { onConflict: "question_id" });
  }
}
