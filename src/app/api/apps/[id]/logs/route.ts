import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { SendLog, type SendLogStatus } from "@/models/SendLog";
import { getSession } from "@/lib/auth";
import { peekDailySend } from "@/lib/send-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// `all=1` skips the pager for the export, so it needs its own ceiling: this collection
// only ever grows (90 days of every attempt on a busy form), and an unbounded read
// would hand Node every row at once to serialise. The UI is told when the cap bit,
// because a silently partial CSV is worse than a refused one.
const EXPORT_MAX_ROWS = 5000;

const STATUSES: SendLogStatus[] = [
  "sent",
  "smtp_failed",
  "blocked_bot",
  "blocked_spam",
  "blocked_attachment",
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight UTC of a `YYYY-MM-DD` day, or null if it isn't one. */
function dayStart(value: string): Date | null {
  if (!DAY.test(value)) return null;
  const at = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

// GET /api/apps/[id]/logs?page=0&from=&to=&status=&all=1 — the owner's own delivery
// history for one app (SPEC §4f, HARDENING_ROADMAP §4.6). The same rows the admin view
// reads, scoped to one app the caller owns: "did it arrive, and if not what did the
// provider say" is a question the app's owner has to be able to answer without asking us.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  // Guard before querying: a malformed id would otherwise throw a CastError.
  if (!isValidObjectId(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await connectDB();
  // Ownership is enforced in the query itself, not by comparing afterwards.
  const app = await App.findOne({ _id: id, userId: session.userId })
    .select("_id websiteName")
    .lean();
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get("page") ?? "0") || 0);
  const all = url.searchParams.get("all") === "1";

  // Filters are validated here rather than forwarded: an unparsed date or an unknown
  // status reaching Mongo is either a CastError 500 or a query that quietly matches
  // nothing, and both read to the owner as "the filter is broken".
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const status = url.searchParams.get("status");
  const fromAt = from ? dayStart(from) : null;
  const toAt = to ? dayStart(to) : null;
  if (from && !fromAt) {
    return NextResponse.json({ error: "invalid_filter", param: "from" }, { status: 400 });
  }
  if (to && !toAt) {
    return NextResponse.json({ error: "invalid_filter", param: "to" }, { status: 400 });
  }
  if (status && !STATUSES.includes(status as SendLogStatus)) {
    return NextResponse.json({ error: "invalid_filter", param: "status" }, { status: 400 });
  }

  const filter: Record<string, unknown> = { appId: id };
  if (fromAt || toAt) {
    filter.createdAt = {
      ...(fromAt ? { $gte: fromAt } : {}),
      // The whole of the `to` day, so a row written after midnight on it is still
      // included — `$lte` on the date alone would drop all but the first instant.
      ...(toAt ? { $lt: new Date(toAt.getTime() + 86_400_000) } : {}),
    };
  }
  if (status) filter.status = status;

  const [logs, total, byStatus, today] = await Promise.all([
    SendLog.find(filter)
      // Still served by the { appId: 1, createdAt: -1 } index (HARDENING_ROADMAP §2.4):
      // the added createdAt range and the sort both ride its second key, and a `status`
      // equality is filtered off the same scan rather than needing an index of its own.
      .sort({ createdAt: -1 })
      .skip(all ? 0 : page * PAGE_SIZE)
      .limit(all ? EXPORT_MAX_ROWS : PAGE_SIZE)
      .select("kind status error createdAt")
      .lean(),
    SendLog.countDocuments(filter),
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
    page: all ? 0 : page,
    pageSize: all ? logs.length : PAGE_SIZE,
    total,
    // Whole-app figures on purpose: they are the panel's headline counts, and a set
    // that moved with the modal's filters would contradict what the panel shows.
    counts,
    today,
    websiteName: app.websiteName,
    truncated: all && total > EXPORT_MAX_ROWS,
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
