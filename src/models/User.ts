import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user", index: true },
    disabled: { type: Boolean, default: false },
    // Proof the address exists and belongs to whoever registered: set when the
    // emailed OTP is entered. Until then the account can log in but reaches only
    // /verify-email (SPEC §3a). Only ever goes false → true.
    emailVerified: { type: Boolean, default: false },
    // sha256 of the current registration OTP, its expiry, and how many wrong
    // guesses have been made — the attempt cap is what makes an 8-char code safe.
    emailOtpHash: { type: String, default: null },
    emailOtpExpiresAt: { type: Date, default: null },
    emailOtpAttempts: { type: Number, default: 0 },
    resetTokenHash: { type: String, default: null },
    resetTokenExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof UserSchema>;

export const User: Model<UserDoc> =
  (models.User as Model<UserDoc>) || model<UserDoc>("User", UserSchema);
