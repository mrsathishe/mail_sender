#!/usr/bin/env node
// One-off, idempotent migration for OTP email verification
// (docs/SPEC.md §3a, §3e — docs/HARDENING_ROADMAP.md §1.1):
//
//   1. users without `emailVerified` → true  (grandfathered: they registered
//      before the OTP existed, so forcing them through it would lock everyone —
//      including the admin — out of the dashboard on deploy)
//   2. apps without `destinationVerified` → true ONLY when the destination equals
//      the owner's own (now grandfathered) address; every other destination → false,
//      because third-party inboxes were never asked whether they wanted this mail
//
// Consequence of (2): apps pointing somewhere other than the owner's own address
// stop delivering (403 destination_unverified) until the owner opens the dashboard,
// sends a code and enters it. That also rotates the secret key, so those sites need
// the new key. Warn users before running this.
//
// Run it with the service STOPPED, before rebuilding:
//   node scripts/migrate-destination-verification.mjs
//
// Safe to re-run: each filter matches nothing once applied.

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

  const users = await db.collection("users").updateMany(
    { emailVerified: { $exists: false } },
    { $set: { emailVerified: true, emailOtpHash: null, emailOtpExpiresAt: null, emailOtpAttempts: 0 } }
  );
  console.log(`users grandfathered as email-verified:        ${users.modifiedCount}`);

  const pendingApps = await db
    .collection("apps")
    .find({ destinationVerified: { $exists: false } })
    .toArray();

  let ownAddress = 0;
  let thirdParty = 0;
  for (const app of pendingApps) {
    const owner = await db.collection("users").findOne({ _id: app.userId }, { projection: { email: 1 } });
    const isOwn =
      Boolean(owner?.email) &&
      String(owner.email).toLowerCase() === String(app.destinationEmail ?? "").toLowerCase();
    await db.collection("apps").updateOne(
      { _id: app._id },
      {
        $set: {
          destinationVerified: isOwn,
          destinationOtpHash: null,
          destinationOtpExpiresAt: null,
          destinationOtpAttempts: 0,
        },
      }
    );
    if (isOwn) ownAddress++;
    else thirdParty++;
  }
  console.log(`apps auto-confirmed (destination = owner):     ${ownAddress}`);
  console.log(`apps needing a destination code:               ${thirdParty}`);

  const blocked = await db.collection("apps").countDocuments({ destinationVerified: false });
  console.log(`apps currently blocked from sending (total):   ${blocked}`);

  console.log("Done.");
} finally {
  await mongoose.disconnect();
}
