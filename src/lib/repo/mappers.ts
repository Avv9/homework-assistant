import type {
  Category, Specialization, Level, Course, Assignment,
  SourceFile, ExtractedQuestion, AiGeneratedAnswer, Admin, AuditLogEntry,
} from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function mapCategory(r: Row): Category {
  return {
    id: r.id, slug: r.slug, nameAr: r.name_ar, nameEn: r.name_en,
    requiresSpecialization: r.requires_specialization, isActive: r.is_active, sortOrder: r.sort_order,
  };
}

export function mapSpecialization(r: Row): Specialization {
  return { id: r.id, categoryId: r.category_id, nameAr: r.name_ar, nameEn: r.name_en, isActive: r.is_active, sortOrder: r.sort_order };
}

export function mapLevel(r: Row): Level {
  return { id: r.id, specializationId: r.specialization_id, number: r.number, nameAr: r.name_ar, nameEn: r.name_en, isActive: r.is_active };
}

export function mapCourse(r: Row): Course {
  return {
    id: r.id, categoryId: r.category_id, specializationId: r.specialization_id ?? null,
    levelId: r.level_id ?? null, code: r.code ?? undefined,
    nameAr: r.name_ar, nameEn: r.name_en,
    descriptionAr: r.description_ar ?? undefined, descriptionEn: r.description_en ?? undefined,
    isActive: r.is_active,
  };
}

export function mapAssignment(r: Row): Assignment {
  return { id: r.id, courseId: r.course_id, nameAr: r.name_ar, nameEn: r.name_en, sortOrder: r.sort_order, isActive: r.is_active };
}

export function mapSourceFile(r: Row): SourceFile {
  return {
    id: r.id, courseId: r.course_id, assignmentId: r.assignment_id,
    storagePath: r.storage_path, fileName: r.file_name,
    status: r.status, uploadedAt: r.uploaded_at,
    sizeBytes: r.size_bytes, pageCount: r.page_count ?? undefined,
    processingError: r.processing_error ?? undefined,
  };
}

export function mapExtractedQuestion(r: Row): ExtractedQuestion {
  return {
    id: r.id, sourceFileId: r.source_file_id ?? "", courseId: r.course_id, assignmentId: r.assignment_id,
    questionNumber: r.question_number ?? undefined, questionText: r.question_text,
    normalizedText: r.normalized_text, answerText: r.answers?.answer_text ?? r.answer_text ?? "",
    pageNumber: r.page_number ?? undefined, confidence: Number(r.confidence ?? 0), published: r.published,
  };
}

export function mapAiAnswer(r: Row): AiGeneratedAnswer {
  return {
    id: r.id, questionText: r.question_text, answerText: r.answer_text,
    categoryId: r.category_id, specializationId: r.specialization_id ?? undefined,
    levelId: r.level_id ?? undefined, courseId: r.course_id, assignmentId: r.assignment_id,
    createdAt: r.created_at, reviewed: r.reviewed, approved: r.approved,
  };
}

export function mapAdmin(r: Row): Admin {
  return {
    id: r.id, email: r.email, fullName: r.full_name ?? undefined,
    role: r.role, isActive: r.is_active,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function mapAuditEntry(r: Row): AuditLogEntry {
  return {
    id: r.id, adminId: r.admin_id, adminEmail: r.admin_email,
    action: r.action, entityType: r.entity_type, entityId: r.entity_id ?? undefined,
    metadata: r.metadata ?? undefined, createdAt: r.created_at,
  };
}
