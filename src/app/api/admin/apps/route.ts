import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { User } from "@/models/User";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/apps — every registered app with its owner's email.
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  await connectDB();
  const apps = await App.find()
    .sort({ createdAt: -1 })
    .select("websiteName destinationGmail userId createdAt")
    .lean();

  const owners = await User.find({ _id: { $in: apps.map((a) => a.userId) } })
    .select("email")
    .lean();
  const emailByUser = new Map(owners.map((o) => [String(o._id), o.email]));

  return NextResponse.json({
    apps: apps.map((a) => ({
      id: String(a._id),
      websiteName: a.websiteName,
      destinationGmail: a.destinationGmail,
      ownerEmail: emailByUser.get(String(a.userId)) ?? "(deleted user)",
      createdAt: a.createdAt,
    })),
  });
}
