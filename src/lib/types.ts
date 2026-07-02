export type CategorySlug = "cci" | "general" | "islamic";

export interface Category {
  id: string;
  slug: CategorySlug;
  nameAr: string;
  nameEn: string;
  requiresSpecialization: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface Specialization {
  id: string;
  categoryId: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
  sortOrder: number;
}

export interface Level {
  id: string;
  specializationId: string;
  number: number;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
}

export interface Course {
  id: string;
  categoryId: string;
  specializationId: string | null;
  levelId: string | null;
  code?: string;
  nameAr: string;
  nameEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
  isActive: boolean;
}

export interface Assignment {
  id: string;
  courseId: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
}

export type FileStatus = "uploaded" | "processing" | "needs_review" | "published" | "failed";

export interface SourceFile {
  id: string;
  courseId: string;
  assignmentId: string;
  storagePath: string;
  fileName: string;
  status: FileStatus;
  uploadedAt: string;
  sizeBytes: number;
  pageCount?: number;
  processingError?: string;
}

export interface ExtractedQuestion {
  id: string;
  sourceFileId: string;
  courseId: string;
  assignmentId: string;
  questionNumber?: number;
  questionText: string;
  normalizedText: string;
  answerText: string;
  pageNumber?: number;
  confidence: number;
  published: boolean;
}

export interface AiGeneratedAnswer {
  id: string;
  questionText: string;
  answerText: string;
  categoryId: string;
  specializationId?: string;
  levelId?: string;
  courseId: string;
  assignmentId: string;
  createdAt: string;
  reviewed: boolean;
  approved: boolean;
}

export interface SearchResultItem {
  questionIndex: number;
  questionText: string;
  answerMarkdown: string;
  source: "approved" | "ai";
  confidence: number;
}

export type AdminRole = "owner" | "editor" | "reviewer" | "viewer";

export interface Admin {
  id: string;
  email: string;
  fullName?: string;
  role: AdminRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  adminId: string;
  adminEmail: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ProcessingJob {
  id: string;
  sourceFileId: string;
  status: FileStatus;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
}
