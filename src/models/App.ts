import { Schema, model, models, Types, type Model, type InferSchemaType } from "mongoose";

const AppSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    websiteName: { type: String, required: true, trim: true },
    destinationGmail: { type: String, required: true, lowercase: true, trim: true },
    // sha256 of the secret key — the plaintext key is shown once and never stored.
    secretKeyHash: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true }
);

export type AppDoc = InferSchemaType<typeof AppSchema> & { _id: Types.ObjectId };

export const App: Model<AppDoc> =
  (models.App as Model<AppDoc>) || model<AppDoc>("App", AppSchema);
