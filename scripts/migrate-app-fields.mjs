#!/usr/bin/env node
// One-off, idempotent migration for the "any destination + mail designs" change
// (docs/MAIL_TEMPLATES_SPEC.md §7):
//
//   1. apps.destinationGmail      → apps.destinationEmail
//   2. sendlogs.destinationGmail  → sendlogs.destinationEmail
//   3. apps without templateId    → templateId: "card"
//
// Run it with the service STOPPED, before rebuilding:
//   node scripts/migrate-app-fields.mjs
//
// Safe to re-run: each filter matches nothing once the migration has been applied.

import { readFileSync } from "node:fs";
import mongoose from "mongoose";

function mongoUri() {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
  // Fall back to .env so the script needs no extra setup on the VPS.
  try {
    const line = readFileSync(new URL("../.env", import.meta.url), "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith("MONGO_URI="));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    /* no .env — fall through */
  }
  throw new Error("MONGO_URI not set (env or .env)");
}

try {
  await mongoose.connect(mongoUri());
  const db = mongoose.connection.db;

  const apps = await db
    .collection("apps")
    .updateMany(
      { destinationGmail: { $exists: true } },
      { $rename: { destinationGmail: "destinationEmail" } }
    );
  console.log(`apps.destinationGmail → destinationEmail:      ${apps.modifiedCount}`);

  const logs = await db
    .collection("sendlogs")
    .updateMany(
      { destinationGmail: { $exists: true } },
      { $rename: { destinationGmail: "destinationEmail" } }
    );
  console.log(`sendlogs.destinationGmail → destinationEmail:  ${logs.modifiedCount}`);

  const templates = await db
    .collection("apps")
    .updateMany({ templateId: { $exists: false } }, { $set: { templateId: "card" } });
  console.log(`apps backfilled with templateId "card":        ${templates.modifiedCount}`);

  console.log("Done.");
} finally {
  await mongoose.disconnect();
}
