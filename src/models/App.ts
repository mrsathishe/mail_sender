import { Schema, model, models, Types, type Model, type InferSchemaType } from "mongoose";
import { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS } from "@/lib/templates";

const AppSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    websiteName: { type: String, required: true, trim: true },
    // Any provider — Gmail, Zoho, Outlook, a custom domain. Only the mailbox we
    // deliver *to*; the sender is always our own SMTP account.
    destinationEmail: { type: String, required: true, lowercase: true, trim: true },
    // Which built-in mail design this app's submissions are rendered with.
    templateId: { type: String, enum: TEMPLATE_IDS, default: DEFAULT_TEMPLATE_ID },
    // sha256 of the secret key — the plaintext key is shown once and never stored.
    secretKeyHash: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true }
);

export type AppDoc = InferSchemaType<typeof AppSchema> & { _id: Types.ObjectId };

export const App: Model<AppDoc> =
  (models.App as Model<AppDoc>) || model<AppDoc>("App", AppSchema);
