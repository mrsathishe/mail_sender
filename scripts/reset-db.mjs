#!/usr/bin/env node
// DESTRUCTIVE: wipe this app's data and start from an empty database.
//
// Drops the five collections in docs/SPEC.md §7 — users, apps, sendlogs,
// dailyusages, senddedupes — and nothing else, so it is safe to point at a database
// that holds other applications' collections too.
//
// `drop` rather than `deleteMany` on purpose: it removes the indexes with the data,
// so the next boot rebuilds them from the current schemas via `autoIndex`. That is
// also why no index migration (scripts/migrate-sendlog-indexes.mjs) is needed after
// a reset — there is nothing left to migrate.
//
// What it means afterwards: every account, app and **secret key** is gone. Any
// website still posting to /v1/send gets `401 invalid_key` until its owner registers
// again. The first admin has to be promoted directly in the DB again
// (`role: "admin"`), because promotion needs an existing admin.
//
// Two flags are required so this can never happen by mistake — the database name
// must be typed out and must match the one in the URI:
//
//   node scripts/reset-db.mjs --db mail_sender --yes
//
// Run it with the service STOPPED, so the running build can't write a row between
// the drop and the restart:
//   sudo systemctl stop mail-sender && node scripts/reset-db.mjs --db mail_sender --yes

import { readFileSync } from "node:fs";
import mongoose from "mongoose";

// Only ours. Anything else in the database is left untouched.
const COLLECTIONS = ["users", "apps", "sendlogs", "dailyusages", "senddedupes"];

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

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1) return process.argv[i + 1]?.startsWith("--") ? true : (process.argv[i + 1] ?? true);
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}

const confirmed = flag("yes") !== undefined;
const namedDb = typeof flag("db") === "string" ? flag("db") : undefined;

try {
  await mongoose.connect(mongoUri());
  const db = mongoose.connection.db;

  console.log(`database: ${db.databaseName}`);
  const present = (await db.listCollections().toArray()).map((c) => c.name);
  let rows = 0;
  for (const name of COLLECTIONS) {
    if (!present.includes(name)) {
      console.log(`  ${name.padEnd(13)} — absent`);
      continue;
    }
    const count = await db.collection(name).countDocuments();
    rows += count;
    console.log(`  ${name.padEnd(13)} ${count} document(s)`);
  }

  if (!confirmed || namedDb !== db.databaseName) {
    console.log(
      "\nNothing was changed. To wipe the collections above, re-run with both flags:\n" +
        `  node scripts/reset-db.mjs --db ${db.databaseName} --yes\n` +
        "This deletes every account, app and secret key permanently."
    );
    process.exitCode = 1;
  } else {
    for (const name of COLLECTIONS) {
      if (!present.includes(name)) continue;
      await db.collection(name).drop();
      console.log(`dropped ${name}`);
    }
    console.log(
      `\nDone — ${rows} document(s) removed. Next steps:\n` +
        "  1. npm run deploy   (or restart the service) — indexes rebuild on first write\n" +
        "  2. register an account at /register and verify it with the emailed code\n" +
        '  3. promote it in the DB to get an admin:  db.users.updateOne({ email: "you@example.com" }, { $set: { role: "admin" } })\n' +
        "  4. re-register each app and update the secret key on every website"
    );
  }
} finally {
  await mongoose.disconnect();
}
