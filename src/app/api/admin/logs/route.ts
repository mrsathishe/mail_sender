import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { SendLog } from "@/models/SendLog";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// GET /api/admin/logs?page=0 — paginated send activity, newest first.
export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get("page") ?? "0") || 0);

  await connectDB();
  const [logs, total] = await Promise.all([
    SendLog.find()
      .sort({ createdAt: -1 })
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select("websiteName destinationGmail status error createdAt")
      .lean(),
    SendLog.countDocuments(),
  ]);

  return NextResponse.json({
    page,
    pageSize: PAGE_SIZE,
    total,
    logs: logs.map((l) => ({
      id: String(l._id),
      websiteName: l.websiteName,
      destinationGmail: l.destinationGmail,
      status: l.status,
      error: l.error ?? null,
      createdAt: l.createdAt,
    })),
  });
}
