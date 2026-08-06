#!/usr/bin/env node
// One-off, idempotent migration for the field id/label split (src/lib/fields.ts).
//
// A field used to be `{ name, required }`, where `name` was both the key the form posted
// and the source of the email row's label (titleized). It is now `{ id, name }`: `id` is
// the posted key, `name` is the label, written by the owner and used verbatim. There is
// no `required` any more — an empty value is delivered as empty, because whether a
// visitor had to fill it in is the website's own check.
//
//   { name: "order-id", required: true }  →  { id: "order-id", name: "Order id" }
//
// The label is seeded with the same titleize() rule the old renderer applied, so no
// email changes wording on the day this runs; owners can then edit "Order id" into
// "Order ID" in the dashboard, which was the point of storing it.
//
// Not strictly required for correctness — resolveFields() reads a legacy row the same
// way — but a document that says what it means is worth having, and the dashboard writes
// the new shape on the next save regardless.
//
// Run it with the service STOPPED, before rebuilding:
//   sudo systemctl stop mail-sender && node scripts/migrate-app-field-ids.mjs
//
// Safe to re-run: apps whose fields already carry `id` are skipped.

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

// Must stay identical to titleize() in src/lib/flatten.ts: `phone_number` → "Phone number".
function titleize(key) {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

try {
  await mongoose.connect(mongoUri());
  const db = mongoose.connection.db;
  const apps = db.collection("apps");

  // Only documents holding at least one field without an `id`. An app whose `fields` is
  // absent entirely needs nothing: the schema default supplies the new shape.
  const stale = await apps.find({ fields: { $elemMatch: { id: { $exists: false } } } }).toArray();
  console.log(`apps with legacy fields: ${stale.length}`);

  let converted = 0;
  for (const app of stale) {
    const fields = (app.fields ?? [])
      .map((f) => {
        // Already converted (a mixed array is possible if a save raced an earlier run).
        if (typeof f?.id === "string" && f.id !== "") {
          return { id: f.id, name: typeof f.name === "string" && f.name !== "" ? f.name : titleize(f.id) };
        }
        if (typeof f?.name !== "string" || f.name === "") return null;
        return { id: f.name, name: titleize(f.name) };
      })
      .filter(Boolean);

    if (fields.length === 0) {
      console.log(`  ${app.websiteName}: no usable fields, left alone`);
      continue;
    }

    await apps.updateOne({ _id: app._id }, { $set: { fields } });
    converted++;
    console.log(`  ${app.websiteName}: ${fields.map((f) => `${f.id} → “${f.name}”`).join(", ")}`);
  }

  console.log(`\nconverted: ${converted}`);
  console.log("Done. Labels are the old titleized wording — edit them in the dashboard.");
} finally {
  await mongoose.disconnect();
}
