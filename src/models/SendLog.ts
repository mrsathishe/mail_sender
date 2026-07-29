import { Schema, model, models, Types, type Model, type InferSchemaType } from "mongoose";

// One row per /v1/send attempt against a known app — powers the admin activity view
// and the owner's own per-app history (SPEC §4f).
const SendLogSchema = new Schema(
  {
    appId: { type: Schema.Types.ObjectId, ref: "App", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    websiteName: { type: String, required: true }, // snapshot at send time
    destinationEmail: { type: String, required: true }, // snapshot at send time
    // Which email this row is about: the submission itself, or the autoresponder's
    // acknowledgement to the submitter (SPEC §4e). Both spend from the same daily
    // allowance, so both have to be visible; defaulted, so existing rows read as
    // submissions without a migration.
    kind: { type: String, enum: ["submission", "autoresponse"], default: "submission" },
    // `blocked_*` rows never reached SMTP — they are the bot and content guards
    // refusing a submission (SPEC §4d), recorded because "my form went quiet" is
    // otherwise unanswerable for the owner.
    status: {
      type: String,
      enum: ["sent", "smtp_failed", "blocked_bot", "blocked_spam"],
      required: true,
    },
    // Why a non-`sent` row ended that way: the provider's own SMTP reply, or which
    // guard fired and on what evidence.
    error: { type: String, default: null },
  },
  { timestamps: true }
);

// Per-app history is always "newest first for one app", so the sort key belongs in
// the index: a bare { appId: 1 } leaves Mongo sorting the matches in memory, and
// this collection only ever grows (HARDENING_ROADMAP §2.4). Replaces the
// single-field appId index, which this one covers as a prefix.
SendLogSchema.index({ appId: 1, createdAt: -1 });

// Retention, not housekeeping: these rows exist to diagnose recent delivery, and
// nothing reads a 90-day-old one. Mongo's TTL monitor does the deleting, so there
// is no cron to own. Ascending on purpose — the same index serves the admin log
// view's `sort({ createdAt: -1 })`, since Mongo walks an index either direction.
export const SEND_LOG_TTL_DAYS = 90;
SendLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: SEND_LOG_TTL_DAYS * 86_400 });

export type SendLogStatus = "sent" | "smtp_failed" | "blocked_bot" | "blocked_spam";
export type SendLogKind = "submission" | "autoresponse";

export type SendLogDoc = InferSchemaType<typeof SendLogSchema> & { _id: Types.ObjectId };

export const SendLog: Model<SendLogDoc> =
  (models.SendLog as Model<SendLogDoc>) || model<SendLogDoc>("SendLog", SendLogSchema);
