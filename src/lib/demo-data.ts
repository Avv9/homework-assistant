import type {
  Category,
  Specialization,
  Level,
  Course,
  Assignment,
  ExtractedQuestion,
} from "./types";

export const categories: Category[] = [
  { id: "cat-cci", slug: "cci", nameAr: "كلية الحوسبة والمعلوماتية", nameEn: "College of Computing and Informatics", requiresSpecialization: true, isActive: true, sortOrder: 1 },
  { id: "cat-general", slug: "general", nameAr: "المقررات العامة", nameEn: "General Courses", requiresSpecialization: false, isActive: true, sortOrder: 2 },
  { id: "cat-islamic", slug: "islamic", nameAr: "المقررات الإسلامية", nameEn: "Islamic Courses", requiresSpecialization: false, isActive: true, sortOrder: 3 },
];

export const specializations: Specialization[] = [
  { id: "spec-it", categoryId: "cat-cci", nameAr: "تقنية المعلومات", nameEn: "Information Technology", isActive: true, sortOrder: 1 },
  { id: "spec-cs", categoryId: "cat-cci", nameAr: "علوم الحاسب", nameEn: "Computer Science", isActive: true, sortOrder: 2 },
  { id: "spec-ds", categoryId: "cat-cci", nameAr: "علم البيانات", nameEn: "Data Science", isActive: true, sortOrder: 3 },
];

const levelNumbers = [3, 4, 5, 6, 7, 8];

export const levels: Level[] = specializations.flatMap((spec) =>
  levelNumbers.map((n) => ({
    id: `level-${spec.id}-${n}`,
    specializationId: spec.id,
    number: n,
    nameAr: `المستوى ${arabicDigits(n)}`,
    nameEn: `Level ${n}`,
    isActive: true,
  }))
);

function arabicDigits(n: number) {
  const map: Record<string, string> = { "0": "٠", "1": "١", "2": "٢", "3": "٣", "4": "٤", "5": "٥", "6": "٦", "7": "٧", "8": "٨", "9": "٩" };
  return String(n).split("").map((d) => map[d] ?? d).join("");
}

interface CourseSeed {
  id: string;
  nameAr: string;
  nameEn: string;
  code: string;
  specializationId: string | null;
  levelNumber: number | null;
  categoryId: string;
}

const cciCourses: CourseSeed[] = [
  { id: "course-intro-it", nameAr: "مقدمة في تقنية المعلومات", nameEn: "Introduction to IT", code: "IT101", specializationId: "spec-it", levelNumber: 3, categoryId: "cat-cci" },
  { id: "course-prog-fund", nameAr: "أساسيات البرمجة", nameEn: "Programming Fundamentals", code: "CS101", specializationId: "spec-cs", levelNumber: 3, categoryId: "cat-cci" },
  { id: "course-networks", nameAr: "شبكات الحاسب", nameEn: "Computer Networks", code: "IT302", specializationId: "spec-it", levelNumber: 4, categoryId: "cat-cci" },
  { id: "course-db", nameAr: "نظم قواعد البيانات", nameEn: "Database Systems", code: "CS303", specializationId: "spec-cs", levelNumber: 4, categoryId: "cat-cci" },
  { id: "course-web", nameAr: "تقنيات الويب", nameEn: "Web Technologies", code: "IT304", specializationId: "spec-it", levelNumber: 5, categoryId: "cat-cci" },
  { id: "course-os", nameAr: "نظم التشغيل", nameEn: "Operating Systems", code: "CS305", specializationId: "spec-cs", levelNumber: 5, categoryId: "cat-cci" },
  { id: "course-ds-struct", nameAr: "هياكل البيانات", nameEn: "Data Structures", code: "CS204", specializationId: "spec-cs", levelNumber: 4, categoryId: "cat-cci" },
  { id: "course-oop", nameAr: "البرمجة كائنية التوجه", nameEn: "Object-Oriented Programming", code: "CS205", specializationId: "spec-cs", levelNumber: 4, categoryId: "cat-cci" },
  { id: "course-algo", nameAr: "تحليل وتصميم الخوارزميات", nameEn: "Algorithms", code: "CS401", specializationId: "spec-cs", levelNumber: 6, categoryId: "cat-cci" },
  { id: "course-ai", nameAr: "الذكاء الاصطناعي", nameEn: "Artificial Intelligence", code: "CS501", specializationId: "spec-cs", levelNumber: 7, categoryId: "cat-cci" },
  { id: "course-intro-ds", nameAr: "مقدمة في علم البيانات", nameEn: "Introduction to Data Science", code: "DS101", specializationId: "spec-ds", levelNumber: 3, categoryId: "cat-cci" },
  { id: "course-data-analysis", nameAr: "تحليل البيانات", nameEn: "Data Analysis", code: "DS302", specializationId: "spec-ds", levelNumber: 5, categoryId: "cat-cci" },
  { id: "course-ml", nameAr: "أساسيات تعلم الآلة", nameEn: "Machine Learning Fundamentals", code: "DS401", specializationId: "spec-ds", levelNumber: 6, categoryId: "cat-cci" },
  { id: "course-stats", nameAr: "الإحصاء", nameEn: "Statistics", code: "DS201", specializationId: "spec-ds", levelNumber: 4, categoryId: "cat-cci" },
];

const generalCourses: CourseSeed[] = [
  { id: "course-english", nameAr: "مهارات اللغة الإنجليزية", nameEn: "English Skills", code: "GEN101", specializationId: null, levelNumber: null, categoryId: "cat-general" },
  { id: "course-comm", nameAr: "مهارات التواصل", nameEn: "Communication Skills", code: "GEN102", specializationId: null, levelNumber: null, categoryId: "cat-general" },
];

const islamicCourses: CourseSeed[] = [
  { id: "course-islamic-culture", nameAr: "الثقافة الإسلامية", nameEn: "Islamic Culture", code: "ISL101", specializationId: null, levelNumber: null, categoryId: "cat-islamic" },
];

const allCourseSeeds = [...cciCourses, ...generalCourses, ...islamicCourses];

export const courses: Course[] = allCourseSeeds.map((c) => ({
  id: c.id,
  categoryId: c.categoryId,
  specializationId: c.specializationId,
  levelId: c.specializationId && c.levelNumber ? `level-${c.specializationId}-${c.levelNumber}` : null,
  code: c.code,
  nameAr: c.nameAr,
  nameEn: c.nameEn,
  descriptionAr: `وصف مختصر لمقرر ${c.nameAr}.`,
  descriptionEn: `A short description for ${c.nameEn}.`,
  isActive: true,
}));

const assignmentNames = [
  { ar: "الواجب الأول", en: "Assignment 1" },
  { ar: "الواجب الثاني", en: "Assignment 2" },
  { ar: "الواجب الثالث", en: "Assignment 3" },
];

export const assignments: Assignment[] = courses.flatMap((course) =>
  assignmentNames.map((a, idx) => ({
    id: `assign-${course.id}-${idx + 1}`,
    courseId: course.id,
    nameAr: a.ar,
    nameEn: a.en,
    sortOrder: idx + 1,
    isActive: true,
  }))
);

// A handful of demo extracted questions so search can be tested without uploads.
export const demoQuestions: ExtractedQuestion[] = [
  {
    id: "q-net-1",
    sourceFileId: "demo-file-1",
    courseId: "course-networks",
    assignmentId: "assign-course-networks-2",
    questionNumber: 1,
    questionText: "What is the difference between TCP and UDP protocols?",
    normalizedText: "what is the difference between tcp and udp protocols",
    answerText:
      "TCP (Transmission Control Protocol) is connection-oriented, reliable, and guarantees ordered delivery using acknowledgments and retransmission. UDP (User Datagram Protocol) is connectionless, faster, and does not guarantee delivery or order, which makes it suitable for real-time applications such as video streaming and online gaming.",
    pageNumber: 3,
    confidence: 0.95,
    published: true,
  },
  {
    id: "q-db-1",
    sourceFileId: "demo-file-2",
    courseId: "course-db",
    assignmentId: "assign-course-db-1",
    questionNumber: 1,
    questionText: "Explain the concept of normalization in relational databases.",
    normalizedText: "explain the concept of normalization in relational databases",
    answerText:
      "Normalization is the process of organizing tables to reduce data redundancy and improve data integrity. It involves applying a series of normal forms (1NF, 2NF, 3NF, BCNF) which progressively eliminate repeating groups, partial dependencies, and transitive dependencies.",
    pageNumber: 1,
    confidence: 0.92,
    published: true,
  },
  {
    id: "q-prog-1",
    sourceFileId: "demo-file-3",
    courseId: "course-prog-fund",
    assignmentId: "assign-course-prog-fund-1",
    questionNumber: 1,
    questionText: "Write a function in Python that returns the factorial of a number.",
    normalizedText: "write a function in python that returns the factorial of a number",
    answerText:
      "```python\ndef factorial(n):\n    if n < 0:\n        raise ValueError('n must be non-negative')\n    result = 1\n    for i in range(2, n + 1):\n        result *= i\n    return result\n```\nThe function multiplies all integers from 2 up to `n`. For `n = 0` or `n = 1` it returns `1`.",
    pageNumber: 2,
    confidence: 0.9,
    published: true,
  },
];

export function findCourse(id: string) {
  return courses.find((c) => c.id === id);
}
export function findAssignment(id: string) {
  return assignments.find((a) => a.id === id);
}
export function findCategory(id: string) {
  return categories.find((c) => c.id === id);
}
export function findSpecialization(id: string) {
  return specializations.find((s) => s.id === id);
}
export function findLevel(id: string) {
  return levels.find((l) => l.id === id);
}
