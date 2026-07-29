#!/usr/bin/env node
// One-off, idempotent index migration for `sendlogs`
// (docs/HARDENING_ROADMAP.md §2.4):
//
//   1. create { appId: 1, createdAt: -1 }  — per-app history, newest first
//   2. create { createdAt: 1 } with a 90-day TTL — retention, and it doubles as the
//      admin log view's sort index (Mongo walks an index in either direction)
//   3. drop the now-redundant single-field { appId: 1 }, which the compound index
//      covers as a prefix
//
// Mongoose would build (1) and (2) itself on next boot via autoIndex, but never
// drops (3), and an unattended TTL build on a large collection is not something to
// discover during a deploy. Doing it here makes both explicit and observable.
//
// FIRST RUN DELETES DATA: the TTL index starts reaping rows older than 90 days
// within a minute of being built. That is the point of §2.4 — but if the send log
// is wanted as a permanent audit trail, stop here and change SEND_LOG_TTL_DAYS in
// src/models/SendLog.ts instead.
//
// Run it with the service STOPPED, before rebuilding:
//   node scripts/migrate-sendlog-indexes.mjs
//
// Safe to re-run: createIndex is a no-op on an identical spec, and the drop is
// skipped once gone.

import { readFileSync } from "node:fs";
import mongoose from "mongoose";

const TTL_DAYS = 90;

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
  const logs = mongoose.connection.db.collection("sendlogs");

  const total = await logs.countDocuments();
  const cutoff = new Date(Date.now() - TTL_DAYS * 86_400_000);
  const expiring = await logs.countDocuments({ createdAt: { $lt: cutoff } });
  console.log(`rows in sendlogs:                              ${total}`);
  console.log(`older than ${TTL_DAYS} days (the TTL will delete these): ${expiring}`);

  await logs.createIndex({ appId: 1, createdAt: -1 });
  console.log("created index { appId: 1, createdAt: -1 }");

  // A pre-existing TTL index with a different expireAfterSeconds must be modified
  // rather than re-created — createIndex would fail on the conflicting spec.
  const existing = await logs.indexes();
  const ttl = existing.find((i) => i.expireAfterSeconds !== undefined && i.key?.createdAt === 1);
  const seconds = TTL_DAYS * 86_400;
  if (ttl && ttl.expireAfterSeconds !== seconds) {
    await mongoose.connection.db.command({
      collMod: "sendlogs",
      index: { name: ttl.name, expireAfterSeconds: seconds },
    });
    console.log(`changed TTL on ${ttl.name}: ${ttl.expireAfterSeconds}s → ${seconds}s`);
  } else {
    await logs.createIndex({ createdAt: 1 }, { expireAfterSeconds: seconds });
    console.log(`created TTL index { createdAt: 1 } (${TTL_DAYS} days)`);
  }

  const redundant = (await logs.indexes()).find(
    (i) => i.key?.appId === 1 && Object.keys(i.key).length === 1
  );
  if (redundant) {
    await logs.dropIndex(redundant.name);
    console.log(`dropped redundant index ${redundant.name}`);
  } else {
    console.log("no single-field appId index to drop");
  }

  console.log("Done.");
} finally {
  await mongoose.disconnect();
}
