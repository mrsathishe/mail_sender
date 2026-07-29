import { Schema, model, models, Types, type Model, type InferSchemaType } from "mongoose";

// Per-app send counter, one row per app per UTC day (HARDENING_ROADMAP §1.2,
// SPEC §4c). Counting rows in `SendLog` would do the same job, but that collection
// only grows and the count would get slower every day — this stays O(1) forever.
const DailyUsageSchema = new Schema({
  appId: { type: Schema.Types.ObjectId, ref: "App", required: true },
  // `YYYY-MM-DD` in UTC, not a Date: the bucket boundary has to be identical on
  // every replica, and a string key makes the compound index an exact match.
  date: { type: String, required: true },
  count: { type: Number, required: true, default: 0 },
  // TTL anchor — yesterday's counters are of no interest once the day rolls over.
  expiresAt: { type: Date, required: true },
});

// Unique so the atomic upsert in lib/send-limit.ts cannot create two counters for
// the same app-day under concurrency.
DailyUsageSchema.index({ appId: 1, date: 1 }, { unique: true });
DailyUsageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type DailyUsageDoc = InferSchemaType<typeof DailyUsageSchema> & {
  _id: Types.ObjectId;
};

export const DailyUsage: Model<DailyUsageDoc> =
  (models.DailyUsage as Model<DailyUsageDoc>) ||
  model<DailyUsageDoc>("DailyUsage", DailyUsageSchema);
