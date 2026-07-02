import type {
  Category,
  Specialization,
  Level,
  Course,
  Assignment,
  SourceFile,
  ExtractedQuestion,
  AiGeneratedAnswer,
  Admin,
  AdminRole,
  AuditLogEntry,
} from "../types";

// ─── Public repository (no auth required) ────────────────────────────────────

export interface PublicRepo {
  getCategories(): Promise<Category[]>;
  getCategoryBySlug(slug: string): Promise<Category | null>;
  getSpecializations(categoryId: string): Promise<Specialization[]>;
  getSpecializationById(id: string): Promise<Specialization | null>;
  getLevels(specializationId: string): Promise<Level[]>;
  getLevelById(id: string): Promise<Level | null>;
  getCourses(opts: { categoryId?: string; specializationId?: string; levelId?: string }): Promise<Course[]>;
  getCourseById(id: string): Promise<Course | null>;
  getAssignments(courseId: string): Promise<Assignment[]>;
  getAssignmentById(id: string): Promise<Assignment | null>;
  /** Search published Q/A pairs for a course+assignment; returns best matches ranked by score */
  searchQuestions(
    courseId: string,
    assignmentId: string,
    queryText: string,
    queryEmbedding: number[] | null
  ): Promise<Array<{ question: ExtractedQuestion; score: number }>>;
  saveAiAnswer(answer: Omit<AiGeneratedAnswer, "id" | "createdAt" | "reviewed" | "approved">): Promise<void>;
}

// ─── Admin repository (authenticated, role-checked by caller) ─────────────────

export interface AdminRepo extends PublicRepo {
  // Stats
  getStats(): Promise<{
    courses: number;
    assignments: number;
    files: number;
    approvedQuestions: number;
    pendingAiAnswers: number;
  }>;

  // Categories
  createCategory(data: Omit<Category, "id">): Promise<Category>;
  updateCategory(id: string, data: Partial<Category>): Promise<Category>;
  deleteCategory(id: string): Promise<void>;

  // Specializations
  createSpecialization(data: Omit<Specialization, "id">): Promise<Specialization>;
  updateSpecialization(id: string, data: Partial<Specialization>): Promise<Specialization>;
  deleteSpecialization(id: string): Promise<void>;

  // Levels
  createLevel(data: Omit<Level, "id">): Promise<Level>;
  updateLevel(id: string, data: Partial<Level>): Promise<Level>;
  deleteLevel(id: string): Promise<void>;

  // Courses
  createCourse(data: Omit<Course, "id">): Promise<Course>;
  updateCourse(id: string, data: Partial<Course>): Promise<Course>;
  deleteCourse(id: string): Promise<void>;

  // Assignments
  createAssignment(data: Omit<Assignment, "id" | "sortOrder">): Promise<Assignment>;
  updateAssignment(id: string, data: Partial<Assignment>): Promise<Assignment>;
  deleteAssignment(id: string): Promise<void>;

  // Files
  getFiles(filter?: { courseId?: string; assignmentId?: string }): Promise<SourceFile[]>;
  createFile(data: Omit<SourceFile, "id" | "uploadedAt">): Promise<SourceFile>;
  updateFile(id: string, data: Partial<SourceFile>): Promise<SourceFile>;
  deleteFile(id: string): Promise<void>;

  // Extracted questions
  getExtractedQuestions(filter?: { sourceFileId?: string; courseId?: string; assignmentId?: string }): Promise<ExtractedQuestion[]>;
  createExtractedQuestion(data: Omit<ExtractedQuestion, "id">): Promise<ExtractedQuestion>;
  updateExtractedQuestion(id: string, data: Partial<ExtractedQuestion>): Promise<ExtractedQuestion>;
  deleteExtractedQuestion(id: string): Promise<void>;
  publishQuestionsForFile(sourceFileId: string): Promise<void>;

  // AI answers
  getAiAnswers(filter?: { reviewed?: boolean }): Promise<AiGeneratedAnswer[]>;
  updateAiAnswer(id: string, data: Partial<AiGeneratedAnswer>): Promise<AiGeneratedAnswer>;
  deleteAiAnswer(id: string): Promise<void>;
  approveAiAnswer(id: string, editedAnswer?: string): Promise<void>;

  // Admins (owner-only)
  getAdmins(): Promise<Admin[]>;
  createAdmin(data: { email: string; role: AdminRole; fullName?: string }): Promise<Admin>;
  updateAdmin(id: string, data: Partial<Pick<Admin, "role" | "isActive" | "fullName">>): Promise<Admin>;
  deleteAdmin(id: string): Promise<void>;

  // Audit log
  getAuditLog(limit?: number): Promise<AuditLogEntry[]>;
  addAuditEntry(entry: Omit<AuditLogEntry, "id" | "createdAt">): Promise<void>;

  // Embeddings
  storeEmbedding(questionId: string, embedding: number[]): Promise<void>;
}
