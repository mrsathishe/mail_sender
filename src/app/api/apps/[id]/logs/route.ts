import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { SendLog } from "@/models/SendLog";
import { getSession } from "@/lib/auth";
import { peekDailySend } from "@/lib/send-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// GET /api/apps/[id]/logs?page=0 — the owner's own delivery history for one app
// (SPEC §4f, HARDENING_ROADMAP §4.6). The same rows the admin view reads, scoped to
// one app the caller owns: "did it arrive, and if not what did the provider say" is a
// question the app's owner has to be able to answer without asking us.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  // Guard before querying: a malformed id would otherwise throw a CastError.
  if (!isValidObjectId(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await connectDB();
  // Ownership is enforced in the query itself, not by comparing afterwards.
  const app = await App.findOne({ _id: id, userId: session.userId }).select("_id").lean();
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get("page") ?? "0") || 0);

  const [logs, total, byStatus, today] = await Promise.all([
    SendLog.find({ appId: id })
      // Served by the { appId: 1, createdAt: -1 } index (HARDENING_ROADMAP §2.4).
      .sort({ createdAt: -1 })
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select("kind status error createdAt")
      .lean(),
    SendLog.countDocuments({ appId: id }),
    // Counts over the retention window (90 days), grouped in Mongo rather than by
    // pulling every row back to count them here.
    SendLog.aggregate<{ _id: string; count: number }>([
      { $match: { appId: app._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    peekDailySend(id),
  ]);

  const counts = {
    sent: 0,
    smtp_failed: 0,
    blocked_bot: 0,
    blocked_spam: 0,
    blocked_attachment: 0,
  };
  for (const row of byStatus) {
    if (row._id in counts) counts[row._id as keyof typeof counts] = row.count;
  }

  return NextResponse.json({
    page,
    pageSize: PAGE_SIZE,
    total,
    counts,
    today,
    logs: logs.map((l) => ({
      id: String(l._id),
      // Defaulted in the schema, but a `.lean()` read of a row written before `kind`
      // existed has no value at all.
      kind: l.kind ?? "submission",
      status: l.status,
      error: l.error ?? null,
      createdAt: l.createdAt,
    })),
  });
}
