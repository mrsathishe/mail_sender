import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    resetTokenHash: { type: String, default: null },
    resetTokenExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof UserSchema>;

export const User: Model<UserDoc> =
  (models.User as Model<UserDoc>) || model<UserDoc>("User", UserSchema);
