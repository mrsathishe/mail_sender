import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { App } from "@/models/App";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/users — every user with role, disabled flag, and app count.
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  await connectDB();
  const [users, counts] = await Promise.all([
    User.find().sort({ createdAt: -1 }).select("email role disabled createdAt").lean(),
    App.aggregate<{ _id: unknown; count: number }>([
      { $group: { _id: "$userId", count: { $sum: 1 } } },
    ]),
  ]);

  const countByUser = new Map(counts.map((c) => [String(c._id), c.count]));

  return NextResponse.json({
    users: users.map((u) => ({
      id: String(u._id),
      email: u.email,
      role: u.role ?? "user",
      disabled: Boolean(u.disabled),
      appCount: countByUser.get(String(u._id)) ?? 0,
      createdAt: u.createdAt,
    })),
  });
}
