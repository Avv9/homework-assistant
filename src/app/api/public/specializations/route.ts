import { NextRequest, NextResponse } from "next/server";
import { getPublicRepo } from "@/lib/repo";

export async function GET(req: NextRequest) {
  const categoryId = req.nextUrl.searchParams.get("categoryId") ?? "";
  const id = req.nextUrl.searchParams.get("id");
  const repo = await getPublicRepo();
  if (id) {
    const s = await repo.getSpecializationById(id);
    if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(s);
  }
  return NextResponse.json(await repo.getSpecializations(categoryId));
}
