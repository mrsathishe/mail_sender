import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { getSession } from "@/lib/auth";
import { TEMPLATE_IDS } from "@/lib/templates";

export const runtime = "nodejs";

const patchSchema = z.object({ templateId: z.enum(TEMPLATE_IDS) });

// PATCH /api/apps/[id] — switch which mail design one of the current user's apps
// renders its submissions with. The design catalog is fixed, so this is the only
// editable setting.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const { id } = await params;
  // Guard before querying: a malformed id would otherwise throw a CastError.
  if (!isValidObjectId(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await connectDB();
  // Scope by userId so a user can only change apps they own.
  const app = await App.findOneAndUpdate(
    { _id: id, userId: session.userId },
    { templateId: parsed.data.templateId },
    { new: true }
  ).select("websiteName destinationEmail templateId");
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    id: String(app._id),
    websiteName: app.websiteName,
    destinationEmail: app.destinationEmail,
    templateId: app.templateId,
  });
}
