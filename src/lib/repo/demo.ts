import type { AdminRepo } from "./interface";
import type {
  Category, Specialization, Level, Course, Assignment,
  SourceFile, ExtractedQuestion, AiGeneratedAnswer,
  Admin, AdminRole, AuditLogEntry,
} from "../types";
import { categories as seedCats, specializations as seedSpecs, levels as seedLevels,
  courses as seedCourses, assignments as seedAssignments, demoQuestions } from "../demo-data";
import { hybridSearch } from "../search";
import { normalize } from "../search";

// Per-process in-memory store (demo only)
function makeStore() {
  return {
    categories: structuredClone(seedCats) as Category[],
    specializations: structuredClone(seedSpecs) as Specialization[],
    levels: structuredClone(seedLevels) as Level[],
    courses: structuredClone(seedCourses) as Course[],
    assignments: structuredClone(seedAssignments) as Assignment[],
    files: [] as SourceFile[],
    extractedQuestions: structuredClone(demoQuestions) as ExtractedQuestion[],
    aiAnswers: [] as AiGeneratedAnswer[],
    admins: [] as Admin[],
    auditLog: [] as AuditLogEntry[],
  };
}

const g = globalThis as Record<string, unknown>;
if (!g.__demoStore) g.__demoStore = makeStore();
const store = g.__demoStore as ReturnType<typeof makeStore>;

function uid() { return `demo-${Math.random().toString(36).slice(2, 10)}`; }

export class DemoRepo implements AdminRepo {
  // ── Public ──────────────────────────────────────────────────────────────────
  async getCategories() { return store.categories.filter(c => c.isActive).sort((a,b)=>a.sortOrder-b.sortOrder); }
  async getCategoryBySlug(slug: string) { return store.categories.find(c=>c.slug===slug && c.isActive) ?? null; }
  async getSpecializations(categoryId: string) { return store.specializations.filter(s=>s.categoryId===categoryId && s.isActive).sort((a,b)=>a.sortOrder-b.sortOrder); }
  async getSpecializationById(id: string) { return store.specializations.find(s=>s.id===id) ?? null; }
  async getLevels(specializationId: string) { return store.levels.filter(l=>l.specializationId===specializationId && l.isActive); }
  async getLevelById(id: string) { return store.levels.find(l=>l.id===id) ?? null; }
  async getCourses(opts: {categoryId?:string;specializationId?:string;levelId?:string}) {
    return store.courses.filter(c => {
      if (!c.isActive) return false;
      if (opts.categoryId && c.categoryId !== opts.categoryId) return false;
      if (opts.specializationId && c.specializationId !== opts.specializationId) return false;
      if (opts.levelId && c.levelId !== opts.levelId) return false;
      return true;
    });
  }
  async getCourseById(id: string) { return store.courses.find(c=>c.id===id) ?? null; }
  async getAssignments(courseId: string) { return store.assignments.filter(a=>a.courseId===courseId && a.isActive).sort((a,b)=>a.sortOrder-b.sortOrder); }
  async getAssignmentById(id: string) { return store.assignments.find(a=>a.id===id) ?? null; }

  async searchQuestions(courseId: string, assignmentId: string, queryText: string) {
    const results = hybridSearch(queryText, courseId, assignmentId, store.extractedQuestions);
    return results.map(r => ({ question: r.question, score: r.score }));
  }

  async saveAiAnswer(answer: Omit<AiGeneratedAnswer, "id"|"createdAt"|"reviewed"|"approved">) {
    store.aiAnswers.push({ ...answer, id: uid(), createdAt: new Date().toISOString(), reviewed: false, approved: false });
  }

  // ── Admin stats ─────────────────────────────────────────────────────────────
  async getStats() {
    return {
      courses: store.courses.length,
      assignments: store.assignments.length,
      files: store.files.length,
      approvedQuestions: store.extractedQuestions.filter(q=>q.published).length,
      pendingAiAnswers: store.aiAnswers.filter(a=>!a.reviewed).length,
    };
  }

  // ── Categories ───────────────────────────────────────────────────────────────
  async createCategory(data: Omit<Category,"id">) { const item={...data,id:uid()}; store.categories.push(item); return item; }
  async updateCategory(id:string,data:Partial<Category>) { const i=store.categories.findIndex(c=>c.id===id); if(i<0) throw new Error("not_found"); store.categories[i]={...store.categories[i],...data}; return store.categories[i]; }
  async deleteCategory(id:string) { store.categories=store.categories.filter(c=>c.id!==id); }

  // ── Specializations ──────────────────────────────────────────────────────────
  async createSpecialization(data:Omit<Specialization,"id">) { const item={...data,id:uid()}; store.specializations.push(item); return item; }
  async updateSpecialization(id:string,data:Partial<Specialization>) { const i=store.specializations.findIndex(s=>s.id===id); if(i<0) throw new Error("not_found"); store.specializations[i]={...store.specializations[i],...data}; return store.specializations[i]; }
  async deleteSpecialization(id:string) { store.specializations=store.specializations.filter(s=>s.id!==id); }

  // ── Levels ───────────────────────────────────────────────────────────────────
  async createLevel(data:Omit<Level,"id">) { const item={...data,id:uid()}; store.levels.push(item); return item; }
  async updateLevel(id:string,data:Partial<Level>) { const i=store.levels.findIndex(l=>l.id===id); if(i<0) throw new Error("not_found"); store.levels[i]={...store.levels[i],...data}; return store.levels[i]; }
  async deleteLevel(id:string) { store.levels=store.levels.filter(l=>l.id!==id); }

  // ── Courses ──────────────────────────────────────────────────────────────────
  async createCourse(data:Omit<Course,"id">) { const item={...data,id:uid()}; store.courses.push(item); return item; }
  async updateCourse(id:string,data:Partial<Course>) { const i=store.courses.findIndex(c=>c.id===id); if(i<0) throw new Error("not_found"); store.courses[i]={...store.courses[i],...data}; return store.courses[i]; }
  async deleteCourse(id:string) { store.courses=store.courses.filter(c=>c.id!==id); }

  // ── Assignments ───────────────────────────────────────────────────────────────
  async createAssignment(data:Omit<Assignment,"id"|"sortOrder">) { const n=store.assignments.filter(a=>a.courseId===data.courseId).length+1; const item={...data,id:uid(),sortOrder:n}; store.assignments.push(item); return item; }
  async updateAssignment(id:string,data:Partial<Assignment>) { const i=store.assignments.findIndex(a=>a.id===id); if(i<0) throw new Error("not_found"); store.assignments[i]={...store.assignments[i],...data}; return store.assignments[i]; }
  async deleteAssignment(id:string) { store.assignments=store.assignments.filter(a=>a.id!==id); }

  // ── Files ─────────────────────────────────────────────────────────────────────
  async getFiles(filter?: {courseId?:string;assignmentId?:string}) {
    return store.files.filter(f => {
      if (filter?.courseId && f.courseId!==filter.courseId) return false;
      if (filter?.assignmentId && f.assignmentId!==filter.assignmentId) return false;
      return true;
    });
  }
  async createFile(data:Omit<SourceFile,"id"|"uploadedAt">) { const item={...data,id:uid(),uploadedAt:new Date().toISOString()}; store.files.push(item); return item; }
  async updateFile(id:string,data:Partial<SourceFile>) { const i=store.files.findIndex(f=>f.id===id); if(i<0) throw new Error("not_found"); store.files[i]={...store.files[i],...data}; return store.files[i]; }
  async deleteFile(id:string) { store.files=store.files.filter(f=>f.id!==id); store.extractedQuestions=store.extractedQuestions.filter(q=>q.sourceFileId!==id); }

  // ── Extracted questions ───────────────────────────────────────────────────────
  async getExtractedQuestions(filter?: {sourceFileId?:string;courseId?:string;assignmentId?:string}) {
    return store.extractedQuestions.filter(q => {
      if (filter?.sourceFileId && q.sourceFileId!==filter.sourceFileId) return false;
      if (filter?.courseId && q.courseId!==filter.courseId) return false;
      if (filter?.assignmentId && q.assignmentId!==filter.assignmentId) return false;
      return true;
    });
  }
  async createExtractedQuestion(data:Omit<ExtractedQuestion,"id">) { const item={...data,id:uid()}; store.extractedQuestions.push(item); return item; }
  async updateExtractedQuestion(id:string,data:Partial<ExtractedQuestion>) { const i=store.extractedQuestions.findIndex(q=>q.id===id); if(i<0) throw new Error("not_found"); store.extractedQuestions[i]={...store.extractedQuestions[i],...data}; return store.extractedQuestions[i]; }
  async deleteExtractedQuestion(id:string) { store.extractedQuestions=store.extractedQuestions.filter(q=>q.id!==id); }
  async publishQuestionsForFile(sourceFileId:string) {
    store.extractedQuestions=store.extractedQuestions.map(q=>q.sourceFileId===sourceFileId?{...q,published:true}:q);
    const f=store.files.find(f=>f.id===sourceFileId); if(f) f.status="published";
  }

  // ── AI answers ────────────────────────────────────────────────────────────────
  async getAiAnswers(filter?: {reviewed?:boolean}) {
    return store.aiAnswers.filter(a => filter?.reviewed !== undefined ? a.reviewed===filter.reviewed : true).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async updateAiAnswer(id:string,data:Partial<AiGeneratedAnswer>) { const i=store.aiAnswers.findIndex(a=>a.id===id); if(i<0) throw new Error("not_found"); store.aiAnswers[i]={...store.aiAnswers[i],...data}; return store.aiAnswers[i]; }
  async deleteAiAnswer(id:string) { store.aiAnswers=store.aiAnswers.filter(a=>a.id!==id); }
  async approveAiAnswer(id:string,editedAnswer?:string) {
    const a=store.aiAnswers.find(a=>a.id===id); if(!a) return;
    a.reviewed=true; a.approved=true;
    if(editedAnswer) a.answerText=editedAnswer;
    store.extractedQuestions.push({ id:uid(), sourceFileId:"ai-approved", courseId:a.courseId, assignmentId:a.assignmentId,
      questionText:a.questionText, normalizedText:normalize(a.questionText), answerText:a.answerText, confidence:1, published:true });
  }

  // ── Admins (owner-only; demo just stubs) ──────────────────────────────────────
  async getAdmins() { return store.admins; }
  async createAdmin(data:{email:string;role:AdminRole;fullName?:string}) { const item:Admin={id:uid(),email:data.email,fullName:data.fullName,role:data.role,isActive:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; store.admins.push(item); return item; }
  async updateAdmin(id:string,data:Partial<Pick<Admin,"role"|"isActive"|"fullName">>) { const i=store.admins.findIndex(a=>a.id===id); if(i<0) throw new Error("not_found"); store.admins[i]={...store.admins[i],...data,updatedAt:new Date().toISOString()}; return store.admins[i]; }
  async deleteAdmin(id:string) { store.admins=store.admins.filter(a=>a.id!==id); }

  // ── Audit log ─────────────────────────────────────────────────────────────────
  async getAuditLog(limit=100) { return store.auditLog.slice(0,limit); }
  async addAuditEntry(entry:Omit<AuditLogEntry,"id"|"createdAt">) { store.auditLog.unshift({...entry,id:uid(),createdAt:new Date().toISOString()}); }

  // ── Embeddings (no-op in demo) ────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async storeEmbedding(_questionId: string, _embedding: number[]) { /* no-op in demo */ }
}

export const demoRepo = new DemoRepo();
