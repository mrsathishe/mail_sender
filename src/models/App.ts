import { Schema, model, models, Types, type Model, type InferSchemaType } from "mongoose";
import { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS } from "@/lib/templates";
import { DEFAULT_FIELDS } from "@/lib/fields";
import { MAX_MIN_SUBMIT_SECONDS } from "@/lib/bot-guard";
import { DEFAULT_MAX_ATTACHMENTS, MAX_ATTACHMENTS_CEILING } from "@/lib/attachments";
import { AUTO_MESSAGE_MAX, AUTO_SUBJECT_MAX } from "@/lib/auto-responder";

// Subdocument, so a field is one row with its own `required` flag rather than two
// parallel arrays. `_id: false` keeps the list a plain value the API can echo back.
const FieldSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

// Bot signals for this app's submissions (SPEC §4d). All three are off by default:
// they need the owner's form to actually post the fields, so switching them on for
// an existing integration would reject every real submission.
const SpamGuardSchema = new Schema(
  {
    // The honeypot's name is the owner's choice rather than one platform-wide
    // reserved word, which every bot author could learn once (bot-guard.ts).
    honeypotField: { type: String, default: null, trim: true },
    timingField: { type: String, default: null, trim: true },
    minSubmitSeconds: { type: Number, default: 0, min: 0, max: MAX_MIN_SUBMIT_SECONDS },
  },
  { _id: false }
);

// The "we got your message" reply to the submitter (SPEC §4e). Blank subject/message
// mean "use the built-in wording", so an improvement to it reaches every app that
// never customised the text.
const AutoResponderSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    subject: { type: String, default: "", trim: true, maxlength: AUTO_SUBJECT_MAX },
    message: { type: String, default: "", trim: true, maxlength: AUTO_MESSAGE_MAX },
  },
  { _id: false }
);

// Whether this app's form may carry files, and how many. Off by default like the two
// above: a 5MB upload endpoint that every existing key could reach would turn a leaked
// key into a relay, and the owner is the only one who knows their form has a file input
// at all.
const AttachmentsSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    maxFiles: {
      type: Number,
      default: DEFAULT_MAX_ATTACHMENTS,
      min: 1,
      max: MAX_ATTACHMENTS_CEILING,
    },
  },
  { _id: false }
);

const AppSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    websiteName: { type: String, required: true, trim: true },
    // Any provider — Gmail, Zoho, Outlook, a custom domain. Only the mailbox we
    // deliver *to*; the sender is always our own SMTP account.
    destinationEmail: { type: String, required: true, lowercase: true, trim: true },
    // Proof that whoever owns the destination inbox agreed to receive these
    // submissions. Without it anyone could point an app at a third party and use
    // our SMTP account to bomb them, so /v1/send refuses to deliver until it is
    // true (HARDENING_ROADMAP §1.1). Set without an OTP when the destination is
    // the owner's own account email, which registration already proved.
    destinationVerified: { type: Boolean, default: false },
    // sha256 of the OTP emailed to the destination; the plaintext only ever exists
    // in that email. All three are cleared once confirmed.
    destinationOtpHash: { type: String, default: null },
    destinationOtpExpiresAt: { type: Date, default: null },
    destinationOtpAttempts: { type: Number, default: 0 },
    // Which built-in mail design this app's submissions are rendered with.
    templateId: { type: String, enum: TEMPLATE_IDS, default: DEFAULT_TEMPLATE_ID },
    // The submission contract: /v1/send accepts these field names and nothing
    // else (SPEC §4b). Defaulted rather than required so registering an app stays
    // a short form — the four defaults suit almost every contact form. Fresh
    // objects per document, so Mongoose casting can't reach the shared constant.
    fields: { type: [FieldSchema], default: () => DEFAULT_FIELDS.map((f) => ({ ...f })) },
    // Both default to "off", so every existing app keeps behaving exactly as before
    // and no migration is needed (SPEC §4d, §4e).
    spamGuard: { type: SpamGuardSchema, default: () => ({}) },
    autoResponder: { type: AutoResponderSchema, default: () => ({}) },
    // Same reasoning, and the same absence of a migration.
    attachments: { type: AttachmentsSchema, default: () => ({}) },
    // sha256 of the secret key — the plaintext key is shown once and never stored.
    secretKeyHash: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true }
);

export type AppDoc = InferSchemaType<typeof AppSchema> & { _id: Types.ObjectId };

export const App: Model<AppDoc> =
  (models.App as Model<AppDoc>) || model<AppDoc>("App", AppSchema);
