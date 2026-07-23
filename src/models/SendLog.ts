import { Schema, model, models, Types, type Model, type InferSchemaType } from "mongoose";

// One row per /v1/send attempt against a known app — powers the admin activity view.
const SendLogSchema = new Schema(
  {
    appId: { type: Schema.Types.ObjectId, ref: "App", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    websiteName: { type: String, required: true }, // snapshot at send time
    destinationGmail: { type: String, required: true }, // snapshot at send time
    status: { type: String, enum: ["sent", "smtp_failed"], required: true },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

export type SendLogDoc = InferSchemaType<typeof SendLogSchema> & { _id: Types.ObjectId };

export const SendLog: Model<SendLogDoc> =
  (models.SendLog as Model<SendLogDoc>) || model<SendLogDoc>("SendLog", SendLogSchema);
