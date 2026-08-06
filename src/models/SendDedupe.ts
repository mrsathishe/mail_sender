import { Schema, model, models, Types, type Model, type InferSchemaType } from "mongoose";
import { env } from "@/lib/env";
import { mockSendDedupeModel } from "@/mocks/mock-db";

// Idempotency record for /v1/send (HARDENING_ROADMAP §2.5). One row per distinct
// submission per app, holding the slot for a short window so a double-clicked
// submit button doesn't deliver the same email twice.
//
// A collection rather than an in-process Map: the Docker and k8s targets can run
// more than one replica, and a per-replica cache would miss the retry that landed
// on the other one.
const SendDedupeSchema = new Schema({
  // sha256 of appId + the canonicalised submission. Unique, because uniqueness is
  // what makes claiming a slot atomic — see lib/dedupe.ts.
  key: { type: String, required: true, unique: true },
  // When this claim stops suppressing repeats. Also the TTL anchor, so rows clean
  // themselves up; the code never trusts the reaper for correctness, since Mongo's
  // TTL monitor only sweeps about once a minute.
  expiresAt: { type: Date, required: true },
});

SendDedupeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SendDedupeDoc = InferSchemaType<typeof SendDedupeSchema> & {
  _id: Types.ObjectId;
};

// The MOCK_MODE swap — see the note in models/User.ts. The mock enforces `key`
// uniqueness and throws code 11000, because that collision IS the claim mechanism
// lib/dedupe.ts reads; a mock without it would silently stop suppressing duplicates.
export const SendDedupe: Model<SendDedupeDoc> = env.mockMode
  ? (mockSendDedupeModel as unknown as Model<SendDedupeDoc>)
  : (models.SendDedupe as Model<SendDedupeDoc>) ||
    model<SendDedupeDoc>("SendDedupe", SendDedupeSchema);
