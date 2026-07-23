import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { SendLog } from "@/models/SendLog";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/admin/apps/[id] — remove an app and its send logs.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;

  await connectDB();
  const app = await App.findById(id).select("_id");
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await Promise.all([App.deleteOne({ _id: id }), SendLog.deleteMany({ appId: id })]);

  return NextResponse.json({ ok: true });
}
