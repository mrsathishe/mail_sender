import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { App } from "@/models/App";
import { SendLog } from "@/models/SendLog";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    disabled: z.boolean().optional(),
    role: z.enum(["user", "admin"]).optional(),
  })
  .refine((v) => v.disabled !== undefined || v.role !== undefined, {
    message: "nothing_to_update",
  });

// Would this change leave the system with zero enabled admins?
async function wouldRemoveLastAdmin(targetId: string): Promise<boolean> {
  const enabledAdmins = await User.find({ role: "admin", disabled: { $ne: true } })
    .select("_id")
    .lean();
  return enabledAdmins.length <= 1 && enabledAdmins.some((a) => String(a._id) === targetId);
}

// PATCH /api/admin/users/[id] — enable/disable or change role.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (id === gate.session.userId) {
    return NextResponse.json({ error: "cannot_modify_self" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  await connectDB();
  const user = await User.findById(id);
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Guard the last admin against being disabled or demoted.
  const demoting = parsed.data.role === "user";
  const disabling = parsed.data.disabled === true;
  if ((demoting || disabling) && (await wouldRemoveLastAdmin(id))) {
    return NextResponse.json({ error: "last_admin" }, { status: 409 });
  }

  if (parsed.data.disabled !== undefined) user.disabled = parsed.data.disabled;
  if (parsed.data.role !== undefined) user.role = parsed.data.role;
  await user.save();

  return NextResponse.json({
    id: String(user._id),
    email: user.email,
    role: user.role,
    disabled: user.disabled,
  });
}

// DELETE /api/admin/users/[id] — remove the user and cascade their apps + logs.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (id === gate.session.userId) {
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 400 });
  }

  await connectDB();
  const user = await User.findById(id).select("role disabled");
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (await wouldRemoveLastAdmin(id)) {
    return NextResponse.json({ error: "last_admin" }, { status: 409 });
  }

  await Promise.all([
    App.deleteMany({ userId: id }),
    SendLog.deleteMany({ userId: id }),
    User.deleteOne({ _id: id }),
  ]);

  return NextResponse.json({ ok: true });
}
