import { NextRequest, NextResponse } from "next/server";
import { getPublicRepo } from "@/lib/repo";

export async function GET(req: NextRequest) {
  const courseId = req.nextUrl.searchParams.get("courseId") ?? "";
  const id = req.nextUrl.searchParams.get("id");
  const repo = await getPublicRepo();
  if (id) {
    const a = await repo.getAssignmentById(id);
    if (!a) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(a);
  }
  return NextResponse.json(await repo.getAssignments(courseId));
}
