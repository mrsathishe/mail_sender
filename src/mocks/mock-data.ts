// The mock values MOCK_MODE serves (src/lib/mock-store.ts reads this and nothing
// else, so this is the one file to edit to change what a mock run contains).
//
// Deliberately inert data: no hashing, no `crypto`, no Date.now(). Secret keys and
// the pending OTP are plaintext here and are hashed by the store with the real
// helpers, and ages are relative numbers turned into dates at seed time — so the
// activity lists always read as recent instead of drifting into last month.
//
// Ids are 24-hex on purpose: the API routes call `isValidObjectId(id)` before
// querying and 404 anything else, so a friendlier id like "app-1" would make every
// per-app route unreachable.

import type { AppField } from "@/lib/fields";
import type { SpamGuard } from "@/lib/bot-guard";
import type { AutoResponder } from "@/lib/auto-responder";
import type { AttachmentConfig } from "@/lib/attachments";
import type { TemplateId } from "@/lib/templates";
import type { SendLogKind, SendLogStatus } from "@/models/SendLog";

export type MockUser = {
  id: string;
  email: string;
  /** Plaintext: mock mode compares it directly, which is why the flag is dev-only. */
  password: string;
  role: "user" | "admin";
  disabled: boolean;
  emailVerified: boolean;
  createdDaysAgo: number;
};

export type MockApp = {
  id: string;
  /** Resolved to the owner's id at seed time, so the two can't disagree. */
  ownerEmail: string;
  websiteName: string;
  destinationEmail: string;
  destinationVerified: boolean;
  templateId: TemplateId;
  fields: AppField[];
  spamGuard: SpamGuard;
  autoResponder: AutoResponder;
  attachments: AttachmentConfig;
  /** Hashed by the store exactly like a real key; rotation replaces it. */
  secretKey: string;
  createdDaysAgo: number;
};

export type MockLog = {
  appId: string;
  kind: SendLogKind;
  status: SendLogStatus;
  error: string | null;
  minutesAgo: number;
};

export const MOCK_USER_ID = "aa00000000000000000000a1";
export const MOCK_ADMIN_ID = "aa00000000000000000000a2";

export const MOCK_PORTFOLIO_ID = "bb00000000000000000000b1";
export const MOCK_STORE_ID = "bb00000000000000000000b2";
export const MOCK_UNVERIFIED_ID = "bb00000000000000000000b3";
export const MOCK_ADMIN_APP_ID = "bb00000000000000000000b4";

/**
 * The code that confirms any unverified destination in mock mode — including one
 * created during the session, since no mail can be sent to read a real code from.
 * Drawn from the OTP alphabet (otp.ts excludes I, O, 0, 1) so it types like a real one.
 */
export const MOCK_OTP_CODE = "TESTCODE";

export const MOCK_USERS: MockUser[] = [
  {
    id: MOCK_USER_ID,
    email: "mock@satz.co.in",
    password: "Mock@12345",
    role: "user",
    disabled: false,
    // Verified, or every page would bounce to /verify-email — which is a flow that
    // needs real mail and so is not part of mock mode.
    emailVerified: true,
    createdDaysAgo: 45,
  },
  {
    id: MOCK_ADMIN_ID,
    email: "admin@satz.co.in",
    password: "Admin@12345",
    role: "admin",
    disabled: false,
    emailVerified: true,
    createdDaysAgo: 90,
  },
];

export const MOCK_APPS: MockApp[] = [
  // The plain case: destination is the owner's own verified address, so registration
  // needed no second confirmation, and every guard is off.
  {
    id: MOCK_PORTFOLIO_ID,
    ownerEmail: "mock@satz.co.in",
    websiteName: "Mock Portfolio",
    destinationEmail: "mock@satz.co.in",
    destinationVerified: true,
    templateId: "card",
    fields: [
      { id: "name", name: "Name" },
      { id: "email", name: "Email" },
      { id: "phone", name: "Phone" },
      { id: "message", name: "Message" },
    ],
    spamGuard: { honeypotField: null, timingField: null, minSubmitSeconds: 0 },
    autoResponder: { enabled: false, subject: "", message: "" },
    attachments: { enabled: false, maxFiles: 3 },
    secretKey: "mks_mock_portfolio_key",
    createdDaysAgo: 40,
  },
  // Everything switched on, so all five dashboard editors and the generated snippets
  // have something non-default to render.
  {
    id: MOCK_STORE_ID,
    ownerEmail: "mock@satz.co.in",
    websiteName: "Mock Store",
    destinationEmail: "orders@mockstore.test",
    destinationVerified: true,
    templateId: "accent",
    fields: [
      { id: "name", name: "Name" },
      { id: "email", name: "Email" },
      // The pair earning its keep: neither label is anything a rule could derive.
      { id: "order-id", name: "Order ID" },
      { id: "phone", name: "Phone" },
      { id: "message", name: "How can we help?" },
    ],
    spamGuard: {
      honeypotField: "company_website",
      timingField: "form_started_at",
      minSubmitSeconds: 3,
    },
    autoResponder: {
      enabled: true,
      subject: "We've got your order enquiry",
      message:
        "Thanks for getting in touch about your order.\n\nOur team reads every message and replies within one working day.",
    },
    attachments: { enabled: true, maxFiles: 3 },
    secretKey: "mks_mock_store_key",
    createdDaysAgo: 12,
  },
  // Registered against someone else's inbox and never confirmed: the code prompt,
  // "resend", and the "no usable key" state are all reachable from this row.
  {
    id: MOCK_UNVERIFIED_ID,
    ownerEmail: "mock@satz.co.in",
    websiteName: "Mock Unverified",
    destinationEmail: "owner@unproven.test",
    destinationVerified: false,
    templateId: "minimal",
    fields: [
      { id: "name", name: "Name" },
      { id: "email", name: "Email" },
      { id: "message", name: "Message" },
    ],
    spamGuard: { honeypotField: null, timingField: null, minSubmitSeconds: 0 },
    autoResponder: { enabled: false, subject: "", message: "" },
    attachments: { enabled: false, maxFiles: 3 },
    // Matches a key nobody holds, exactly as a real unconfirmed app does — verifying
    // the destination is what issues a usable one.
    secretKey: "mks_mock_unverified_never_disclosed",
    createdDaysAgo: 2,
  },
  // Admin-owned, so /admin/apps shows two owners and /admin/users two app counts.
  {
    id: MOCK_ADMIN_APP_ID,
    ownerEmail: "admin@satz.co.in",
    websiteName: "Mock Admin Site",
    destinationEmail: "admin@satz.co.in",
    destinationVerified: true,
    templateId: "dark",
    fields: [
      { id: "name", name: "Name" },
      { id: "email", name: "Email" },
      { id: "message", name: "Message" },
    ],
    spamGuard: { honeypotField: null, timingField: null, minSubmitSeconds: 0 },
    autoResponder: { enabled: false, subject: "", message: "" },
    attachments: { enabled: false, maxFiles: 3 },
    secretKey: "mks_mock_admin_site_key",
    createdDaysAgo: 60,
  },
];

// Every status the schema allows, plus both kinds — the panels label them
// differently, so a set missing one leaves that branch untested. Mock Portfolio
// carries more than one page (the panel's page size is 20) and Mock Unverified
// carries none, which is what an app with no usable key really looks like.
export const MOCK_LOGS: MockLog[] = [
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 8 },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 52 },
  {
    appId: MOCK_PORTFOLIO_ID,
    kind: "submission",
    status: "blocked_spam",
    error: "score 11 ≥ 6: 9 links, anchor markup, keywords: backlinks, seo ranking",
    minutesAgo: 96,
  },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 140 },
  {
    appId: MOCK_PORTFOLIO_ID,
    kind: "submission",
    status: "smtp_failed",
    error: "550 5.1.1 <mock@satz.co.in>: Recipient address rejected (code: EENVELOPE, responseCode: 550)",
    minutesAgo: 190,
  },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 240 },
  {
    appId: MOCK_PORTFOLIO_ID,
    kind: "submission",
    status: "blocked_bot",
    error: 'honeypot "company_website" was filled',
    minutesAgo: 300,
  },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 360 },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 420 },
  {
    appId: MOCK_PORTFOLIO_ID,
    kind: "submission",
    status: "blocked_spam",
    error: "score 8 ≥ 6: 6 links, BBCode markup",
    minutesAgo: 500,
  },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 610 },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 700 },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 880 },
  {
    appId: MOCK_PORTFOLIO_ID,
    kind: "submission",
    status: "smtp_failed",
    error: "451 4.7.1 Greylisted, try again later (code: EENVELOPE, responseCode: 451)",
    minutesAgo: 1020,
  },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 1200 },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 1500 },
  {
    appId: MOCK_PORTFOLIO_ID,
    kind: "submission",
    status: "blocked_bot",
    error: "submitted in 0.4s, minimum is 3s",
    minutesAgo: 1800,
  },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 2200 },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 2600 },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 3100 },
  { appId: MOCK_PORTFOLIO_ID, kind: "submission", status: "sent", error: null, minutesAgo: 3600 },
  {
    appId: MOCK_PORTFOLIO_ID,
    kind: "submission",
    status: "blocked_spam",
    error: "score 7 ≥ 6: mail header probe in message",
    minutesAgo: 4200,
  },

  { appId: MOCK_STORE_ID, kind: "submission", status: "sent", error: null, minutesAgo: 15 },
  // The acknowledgement to the submitter, which spends its own quota slot (SPEC §4e).
  { appId: MOCK_STORE_ID, kind: "autoresponse", status: "sent", error: null, minutesAgo: 15 },
  { appId: MOCK_STORE_ID, kind: "submission", status: "sent", error: null, minutesAgo: 120 },
  { appId: MOCK_STORE_ID, kind: "autoresponse", status: "sent", error: null, minutesAgo: 120 },
  {
    appId: MOCK_STORE_ID,
    kind: "submission",
    status: "blocked_attachment",
    error: "invoice.zip: archives are refused",
    minutesAgo: 260,
  },
  {
    appId: MOCK_STORE_ID,
    kind: "autoresponse",
    status: "smtp_failed",
    error: "554 5.7.1 Message rejected by recipient policy (code: EENVELOPE, responseCode: 554)",
    minutesAgo: 480,
  },
  { appId: MOCK_STORE_ID, kind: "submission", status: "sent", error: null, minutesAgo: 480 },
  {
    appId: MOCK_STORE_ID,
    kind: "submission",
    status: "blocked_attachment",
    error: "photo.pdf: bytes are not a PDF",
    minutesAgo: 900,
  },

  { appId: MOCK_ADMIN_APP_ID, kind: "submission", status: "sent", error: null, minutesAgo: 70 },
  { appId: MOCK_ADMIN_APP_ID, kind: "submission", status: "sent", error: null, minutesAgo: 1400 },
  {
    appId: MOCK_ADMIN_APP_ID,
    kind: "submission",
    status: "blocked_bot",
    error: 'honeypot "nickname" was filled',
    minutesAgo: 2900,
  },
];
