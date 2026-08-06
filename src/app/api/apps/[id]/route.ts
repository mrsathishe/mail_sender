import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { getSession } from "@/lib/auth";
import { TEMPLATE_IDS } from "@/lib/templates";
import { parseFields, resolveFields } from "@/lib/fields";
import { parseSpamGuard, resolveSpamGuard } from "@/lib/bot-guard";
import { parseAutoResponder, resolveAutoResponder } from "@/lib/auto-responder";
import { parseAttachmentConfig, resolveAttachmentConfig } from "@/lib/attachments";

export const runtime = "nodejs";

// Every setting is optional so the dashboard can save one panel without touching the
// others, but sending none is a no-op the caller almost certainly didn't mean. Shapes
// only — the rules live in lib/fields, lib/bot-guard, lib/auto-responder and
// lib/attachments, which report *which* rule was broken.
const patchSchema = z
  .object({
    templateId: z.enum(TEMPLATE_IDS).optional(),
    fields: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
    spamGuard: z.looseObject({}).optional(),
    autoResponder: z.looseObject({}).optional(),
    attachments: z.looseObject({}).optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined));

// PATCH /api/apps/[id] — edit one of the current user's apps: which mail design it
// renders submissions with, the form fields /v1/send will accept, the bot guard
// (SPEC §4d), the autoresponder (SPEC §4e) and file attachments. The design
// catalog is fixed and the destination cannot move (it would need a fresh
// confirmation), so these are the only editable settings.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.templateId !== undefined) update.templateId = parsed.data.templateId;
  if (parsed.data.fields !== undefined) {
    const result = parseFields(parsed.data.fields);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    update.fields = result.fields;
  }
  if (parsed.data.spamGuard !== undefined) {
    const result = parseSpamGuard(parsed.data.spamGuard);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    update.spamGuard = result.guard;
  }
  if (parsed.data.autoResponder !== undefined) {
    const result = parseAutoResponder(parsed.data.autoResponder);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    update.autoResponder = result.autoResponder;
  }
  if (parsed.data.attachments !== undefined) {
    const result = parseAttachmentConfig(parsed.data.attachments);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    update.attachments = result.attachments;
  }

  const { id } = await params;
  // Guard before querying: a malformed id would otherwise throw a CastError.
  if (!isValidObjectId(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await connectDB();
  // Scope by userId so a user can only change apps they own.
  const app = await App.findOneAndUpdate({ _id: id, userId: session.userId }, update, {
    new: true,
  }).select("websiteName destinationEmail templateId fields spamGuard autoResponder attachments");
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    id: String(app._id),
    websiteName: app.websiteName,
    destinationEmail: app.destinationEmail,
    templateId: app.templateId,
    fields: resolveFields(app.fields),
    spamGuard: resolveSpamGuard(app.spamGuard),
    autoResponder: resolveAutoResponder(app.autoResponder),
    attachments: resolveAttachmentConfig(app.attachments),
  });
}
