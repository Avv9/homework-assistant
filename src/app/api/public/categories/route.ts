import { NextRequest, NextResponse } from "next/server";
import { getPublicRepo } from "@/lib/repo";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  const repo = await getPublicRepo();
  if (slug) {
    const cat = await repo.getCategoryBySlug(slug);
    if (!cat) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(cat);
  }
  return NextResponse.json(await repo.getCategories());
}
