// The in-memory stand-in for MongoDB that MOCK_MODE runs on, so `next dev` works
// with no database reachable at all (which is the whole reason it exists).
//
// The swap happens in the five files under src/models: each exports either its real
// Mongoose model or the mock one below. **No route, page or lib touches this file** —
// they keep calling `App.find(...)`, `user.save()` and so on, so mock mode cannot
// drift from the real behaviour by way of a second code path.
//
// Values come from ./mock-data.ts, which is the only file to edit to change what a
// mock run contains. Password, key and OTP hashes are derived here with the real
// helpers, so the seeded rows are shaped exactly like stored ones.
//
// What is supported is exactly what the app calls today (see `unsupported()`): equality
// filters plus $ne/$in/$gt/$gte/$lt/$lte, sort/skip/limit/lean, create, countDocuments, a
// two-stage $match/$group aggregation, findOneAndUpdate with $set/$inc/$setOnInsert and
// upsert, and the delete pair. Anything else throws by name rather than quietly
// returning the wrong rows — a mock that lies is worse than no mock.

import { randomBytes } from "crypto";
import { hashPassword } from "@/lib/password";
import { hashSecret } from "@/lib/secret";
import { hashOtp, otpExpiry } from "@/lib/otp";
import { MOCK_APPS, MOCK_LOGS, MOCK_OTP_CODE, MOCK_USERS } from "./mock-data";

export type MockRow = Record<string, unknown> & { _id: string };

type Store = Record<CollectionName, MockRow[]>;

type CollectionName = "users" | "apps" | "sendlogs" | "dailyusages" | "senddedupes";

function unsupported(what: string): never {
  throw new Error(
    `MOCK_MODE: ${what} is not implemented by src/mocks/mock-db.ts — add it there or run against a real MONGO_URI`
  );
}

// --- Seeding ----------------------------------------------------------------

/** A fresh 24-hex id — what an ObjectId is, so `isValidObjectId()` accepts it. */
function newId(): string {
  return randomBytes(12).toString("hex");
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

async function buildStore(): Promise<Store> {
  const users: MockRow[] = [];
  for (const user of MOCK_USERS) {
    users.push({
      _id: user.id,
      email: user.email.toLowerCase(),
      // A real bcrypt hash, because the login route is untouched and so still calls
      // verifyPassword() — the mock file holds the password, never the hash.
      passwordHash: await hashPassword(user.password),
      role: user.role,
      disabled: user.disabled,
      emailVerified: user.emailVerified,
      emailOtpHash: null,
      emailOtpExpiresAt: null,
      emailOtpAttempts: 0,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      createdAt: daysAgo(user.createdDaysAgo),
      updatedAt: daysAgo(user.createdDaysAgo),
    });
  }

  const idByEmail = new Map(users.map((u) => [String(u.email), u._id]));
  const apps: MockRow[] = MOCK_APPS.map((app) => {
    const userId = idByEmail.get(app.ownerEmail.toLowerCase());
    // A typo'd ownerEmail would otherwise produce an app nobody owns and an empty
    // dashboard that reads like a bug in the route.
    if (!userId) {
      throw new Error(`mock app "${app.websiteName}" has no such owner: ${app.ownerEmail}`);
    }
    return {
      _id: app.id,
      userId,
      websiteName: app.websiteName,
      destinationEmail: app.destinationEmail.toLowerCase(),
      destinationVerified: app.destinationVerified,
      // An unconfirmed destination has a code pending, so the dashboard's prompt is
      // usable on a fresh run — there is no mail to read the real one from.
      destinationOtpHash: app.destinationVerified ? null : hashOtp(MOCK_OTP_CODE),
      destinationOtpExpiresAt: app.destinationVerified ? null : otpExpiry(),
      destinationOtpAttempts: 0,
      templateId: app.templateId,
      fields: app.fields.map((f) => ({ ...f })),
      spamGuard: { ...app.spamGuard },
      autoResponder: { ...app.autoResponder },
      attachments: { ...app.attachments },
      secretKeyHash: hashSecret(app.secretKey),
      createdAt: daysAgo(app.createdDaysAgo),
      updatedAt: daysAgo(app.createdDaysAgo),
    };
  });

  const appById = new Map(apps.map((a) => [a._id, a]));
  const sendlogs: MockRow[] = MOCK_LOGS.map((log, i) => {
    const app = appById.get(log.appId);
    if (!app) throw new Error(`mock log ${i} references no such app: ${log.appId}`);
    const createdAt = minutesAgo(log.minutesAgo);
    return {
      _id: `cc${"0".repeat(20)}${i.toString(16).padStart(2, "0")}`,
      appId: app._id,
      userId: app.userId,
      // Snapshots, as SendLog stores them — read off the app so the two agree.
      websiteName: app.websiteName,
      destinationEmail: app.destinationEmail,
      kind: log.kind,
      status: log.status,
      error: log.error,
      createdAt,
      updatedAt: createdAt,
    };
  });

  // Today's counter, derived from the seeded rows so the activity panel's "used today"
  // cannot disagree with the rows above it. Only sent/smtp_failed count: a blocked
  // submission is refused before the quota (SPEC §4d).
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = new Map<string, number>();
  for (const log of sendlogs) {
    const status = String(log.status);
    if (status !== "sent" && status !== "smtp_failed") continue;
    if ((log.createdAt as Date).toISOString().slice(0, 10) !== today) continue;
    const appId = String(log.appId);
    usedToday.set(appId, (usedToday.get(appId) ?? 0) + 1);
  }
  const dailyusages: MockRow[] = [...usedToday].map(([appId, count]) => ({
    _id: newId(),
    appId,
    date: today,
    count,
    expiresAt: new Date(Date.now() + 2 * 86_400_000),
  }));

  return { users, apps, sendlogs, dailyusages, senddedupes: [] };
}

// Cached on `global` for the same reason as the Mongoose connection in lib/db.ts:
// without it every dev hot-reload would re-seed and throw away the apps and edits made
// while clicking through the dashboard. The promise is cached, not the result, so two
// concurrent first requests cannot both seed.
const globalForMock = global as unknown as { _mockDb?: Promise<Store> };

function store(): Promise<Store> {
  if (!globalForMock._mockDb) globalForMock._mockDb = buildStore();
  return globalForMock._mockDb;
}

// --- Filtering ---------------------------------------------------------------

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  // Ids reach a query as strings, ObjectIds or documents; compare by their text form,
  // which is what String(_id) does everywhere in the routes too.
  if (typeof a === "string" || typeof b === "string") return String(a) === String(b);
  return a === b;
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => k.startsWith("$"))
  );
}

function time(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number.NEGATIVE_INFINITY;
}

function matches(row: MockRow, filter: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    const value = row[key];
    if (isOperatorObject(condition)) {
      for (const [op, operand] of Object.entries(condition)) {
        const ok =
          op === "$ne"
            ? !sameValue(value, operand)
            : op === "$in"
              ? Array.isArray(operand) && operand.some((o) => sameValue(value, o))
              : op === "$gt"
                ? time(value) > time(operand)
                : op === "$gte"
                  ? time(value) >= time(operand)
                  : op === "$lt"
                    ? time(value) < time(operand)
                    : op === "$lte"
                      ? time(value) <= time(operand)
                      : unsupported(`query operator ${op}`);
        if (!ok) return false;
      }
      continue;
    }
    if (!sameValue(value, condition)) return false;
  }
  return true;
}

/** The equality part of a filter, which is what Mongo seeds an upserted row from. */
function equalityKeys(filter: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(filter).filter(([, v]) => !isOperatorObject(v)));
}

function sortRows(rows: MockRow[], spec: Record<string, number>): MockRow[] {
  const entries = Object.entries(spec);
  return [...rows].sort((a, b) => {
    for (const [key, direction] of entries) {
      const left = a[key];
      const right = b[key];
      const cmp =
        left instanceof Date && right instanceof Date
          ? left.getTime() - right.getTime()
          : String(left) < String(right)
            ? -1
            : String(left) > String(right)
              ? 1
              : 0;
      if (cmp !== 0) return cmp * (direction < 0 ? -1 : 1);
    }
    return 0;
  });
}

/**
 * `.lean()` hands back detached data in Mongoose, so it does here too — a caller that
 * mutates a lean result must not be editing the store. Hand-rolled rather than
 * `structuredClone` because rows carry a `save()` helper (below) that no clone
 * algorithm can copy, and rather than a JSON round-trip, which would turn every Date
 * into a string.
 */
function detach<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => detach(v)) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  const copy: Record<string, unknown> = {};
  // Own *enumerable* keys only, which is what leaves `save()` behind.
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "function") continue;
    copy[key] = detach(item);
  }
  return copy as T;
}

// --- Documents ---------------------------------------------------------------

/**
 * `save()` is the one deliberate fiction: a mock document IS the stored row, so a
 * mutation has already persisted by the time it is called. It exists so the handlers
 * that mutate a document (issue an OTP, rotate a key, disable a user) run their real
 * code unchanged instead of needing a mock-only write path.
 */
function hydrate(row: MockRow): MockRow {
  if (typeof row.save !== "function") {
    Object.defineProperty(row, "save", { value: async () => row, enumerable: false });
  }
  return row;
}

// --- Query ------------------------------------------------------------------

type QueryShape = { sort: Record<string, number> | null; skip: number; limit: number | null; lean: boolean };

class MockQuery<T> implements PromiseLike<T> {
  private shape: QueryShape = { sort: null, skip: 0, limit: null, lean: false };

  constructor(private readonly run: (shape: QueryShape) => Promise<T>) {}

  sort(spec: Record<string, number>): this {
    this.shape.sort = spec;
    return this;
  }

  /**
   * Ignored on purpose: every caller maps the fields it wants out of the result, so a
   * projection cannot change anything they observe — and honouring it would mean
   * dropping fields the mock still needs to hand back (`passwordHash` at login).
   */
  select(_fields: string): this {
    return this;
  }

  skip(count: number): this {
    this.shape.skip = count;
    return this;
  }

  limit(count: number): this {
    this.shape.limit = count;
    return this;
  }

  lean(): this {
    this.shape.lean = true;
    return this;
  }

  then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.run(this.shape).then(onfulfilled, onrejected);
  }
}

// --- Collections ------------------------------------------------------------

type Update = Record<string, unknown>;

function applyUpdate(row: MockRow, update: Update, inserting: boolean): void {
  for (const [key, value] of Object.entries(update)) {
    if (!key.startsWith("$")) {
      row[key] = value;
      continue;
    }
    const operand = value as Record<string, unknown>;
    if (key === "$set") {
      Object.assign(row, operand);
    } else if (key === "$inc") {
      for (const [field, by] of Object.entries(operand)) {
        row[field] = (typeof row[field] === "number" ? (row[field] as number) : 0) + Number(by);
      }
    } else if (key === "$setOnInsert") {
      if (inserting) Object.assign(row, operand);
    } else {
      unsupported(`update operator ${key}`);
    }
  }
  row.updatedAt = new Date();
}

/** Mongo reports a unique-index violation as code 11000, which lib/dedupe.ts reads. */
function duplicateKeyError(): Error & { code: number } {
  return Object.assign(new Error("E11000 duplicate key error (mock)"), { code: 11000 });
}

class MockCollection {
  constructor(
    private readonly name: CollectionName,
    private readonly defaults: () => Record<string, unknown>,
    /** Field whose uniqueness the app relies on for locking (lib/dedupe.ts). */
    private readonly uniqueField?: string
  ) {}

  private async rows(): Promise<MockRow[]> {
    return (await store())[this.name];
  }

  find(filter: Record<string, unknown> = {}): MockQuery<MockRow[]> {
    return new MockQuery(async (shape) => {
      let found = (await this.rows()).filter((r) => matches(r, filter));
      if (shape.sort) found = sortRows(found, shape.sort);
      found = found.slice(shape.skip, shape.limit === null ? undefined : shape.skip + shape.limit);
      return shape.lean ? detach(found) : found.map(hydrate);
    });
  }

  findOne(filter: Record<string, unknown> = {}): MockQuery<MockRow | null> {
    return new MockQuery(async (shape) => {
      let found = (await this.rows()).filter((r) => matches(r, filter));
      if (shape.sort) found = sortRows(found, shape.sort);
      const first = found[0];
      if (!first) return null;
      return shape.lean ? detach(first) : hydrate(first);
    });
  }

  findById(id: unknown): MockQuery<MockRow | null> {
    return this.findOne({ _id: id });
  }

  /**
   * Only `new: true` is distinguished: no caller reads the pre-update image, so the
   * updated row is returned either way rather than cloning one to throw away.
   */
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Update,
    options: { upsert?: boolean; new?: boolean } = {}
  ): MockQuery<MockRow | null> {
    return new MockQuery(async (shape) => {
      const rows = await this.rows();
      const found = rows.find((r) => matches(r, filter));
      if (found) {
        applyUpdate(found, update, false);
        return shape.lean ? detach(found) : hydrate(found);
      }
      if (!options.upsert) return null;

      const seed = equalityKeys(filter);
      // Uniqueness IS the locking mechanism for the dedupe claim: when a live claim
      // exists the filter misses it (its window hasn't closed) and the insert has to
      // fail, which is what tells lib/dedupe.ts this is a repeat.
      if (this.uniqueField !== undefined) {
        const key = seed[this.uniqueField];
        if (rows.some((r) => sameValue(r[this.uniqueField as string], key))) {
          throw duplicateKeyError();
        }
      }
      const created: MockRow = { _id: newId(), ...this.defaults(), ...seed };
      applyUpdate(created, update, true);
      created.createdAt = new Date();
      rows.push(created);
      return shape.lean ? detach(created) : hydrate(created);
    });
  }

  async create(doc: Record<string, unknown>): Promise<MockRow> {
    if (Array.isArray(doc)) unsupported("create() with an array of documents");
    const rows = await this.rows();
    if (this.uniqueField !== undefined) {
      const key = doc[this.uniqueField];
      if (rows.some((r) => sameValue(r[this.uniqueField as string], key))) throw duplicateKeyError();
    }
    const now = new Date();
    const created: MockRow = {
      _id: newId(),
      ...this.defaults(),
      // Undefined values would otherwise overwrite a default with nothing.
      ...Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined)),
      createdAt: now,
      updatedAt: now,
    };
    rows.push(created);
    return hydrate(created);
  }

  async countDocuments(filter: Record<string, unknown> = {}): Promise<number> {
    return (await this.rows()).filter((r) => matches(r, filter)).length;
  }

  /** `[{ $match }?, { $group: { _id: "$field", count: { $sum: 1 } } }]` and nothing else. */
  async aggregate(pipeline: Record<string, unknown>[]): Promise<{ _id: unknown; count: number }[]> {
    let rows = await this.rows();
    let grouped: { _id: unknown; count: number }[] | null = null;

    for (const stage of pipeline) {
      const [name, spec] = Object.entries(stage)[0] ?? [];
      if (name === "$match") {
        rows = rows.filter((r) => matches(r, spec as Record<string, unknown>));
      } else if (name === "$group") {
        const group = spec as { _id: unknown; count?: { $sum?: unknown } };
        if (typeof group._id !== "string" || !group._id.startsWith("$")) {
          unsupported("a $group on anything but a single field path");
        }
        if (group.count?.$sum !== 1) unsupported("a $group accumulator other than { $sum: 1 }");
        const field = group._id.slice(1);
        const counts = new Map<string, number>();
        for (const row of rows) {
          const key = String(row[field]);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        grouped = [...counts].map(([_id, count]) => ({ _id, count }));
      } else {
        unsupported(`aggregation stage ${name}`);
      }
    }
    return grouped ?? unsupported("an aggregation without a $group stage");
  }

  async deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
    const rows = await this.rows();
    const index = rows.findIndex((r) => matches(r, filter));
    if (index === -1) return { deletedCount: 0 };
    rows.splice(index, 1);
    return { deletedCount: 1 };
  }

  async deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
    const rows = await this.rows();
    const keep = rows.filter((r) => !matches(r, filter));
    const deletedCount = rows.length - keep.length;
    rows.splice(0, rows.length, ...keep);
    return { deletedCount };
  }
}

// Schema defaults, which a `create()` call relies on exactly as the real schemas do —
// e.g. POST /api/apps never sends spamGuard, and every app must still read as "off".

export const mockUserModel = new MockCollection("users", () => ({
  role: "user",
  disabled: false,
  emailVerified: false,
  emailOtpHash: null,
  emailOtpExpiresAt: null,
  emailOtpAttempts: 0,
  resetTokenHash: null,
  resetTokenExpiresAt: null,
}));

export const mockAppModel = new MockCollection("apps", () => ({
  destinationVerified: false,
  destinationOtpHash: null,
  destinationOtpExpiresAt: null,
  destinationOtpAttempts: 0,
  templateId: "card",
  fields: [],
  spamGuard: { honeypotField: null, timingField: null, minSubmitSeconds: 0 },
  autoResponder: { enabled: false, subject: "", message: "" },
  attachments: { enabled: false, maxFiles: 3 },
}));

export const mockSendLogModel = new MockCollection("sendlogs", () => ({
  kind: "submission",
  error: null,
}));

export const mockDailyUsageModel = new MockCollection("dailyusages", () => ({ count: 0 }));

export const mockSendDedupeModel = new MockCollection("senddedupes", () => ({}), "key");
