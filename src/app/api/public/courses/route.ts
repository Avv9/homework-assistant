import { NextRequest, NextResponse } from "next/server";
import { getPublicRepo } from "@/lib/repo";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const categoryId = req.nextUrl.searchParams.get("categoryId") ?? undefined;
  const specializationId = req.nextUrl.searchParams.get("specializationId") ?? undefined;
  const levelId = req.nextUrl.searchParams.get("levelId") ?? undefined;
  const repo = await getPublicRepo();
  if (id) {
    const c = await repo.getCourseById(id);
    if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(c);
  }
  return NextResponse.json(await repo.getCourses({ categoryId, specializationId, levelId }));
}
