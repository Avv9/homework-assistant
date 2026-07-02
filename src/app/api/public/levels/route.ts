import { NextRequest, NextResponse } from "next/server";
import { getPublicRepo } from "@/lib/repo";

export async function GET(req: NextRequest) {
  const specializationId = req.nextUrl.searchParams.get("specializationId") ?? "";
  const id = req.nextUrl.searchParams.get("id");
  const repo = await getPublicRepo();
  if (id) {
    const l = await repo.getLevelById(id);
    if (!l) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(l);
  }
  return NextResponse.json(await repo.getLevels(specializationId));
}
