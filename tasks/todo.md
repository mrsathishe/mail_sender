# Todo — home-page trim, `/contact` page, `200` on send, SEO pass

Scope from the user: remove **Getting started / Integration / Mail designs /
Dashboard** from `/`, move the **FAQ to a new contact page**, add a **help form**, the
**Chennai address** and the **phone number**; plus SEO across every page and `/v1/send`
answering **200** instead of `202`.

(The previous task's checklist — §4.2/§4.4/§4.5/§4.6 — is in git history.)

## 1. Contact details as constants

- [x] `src/lib/brand.ts` — `CONTACT_PHONE`, `CONTACT_PHONE_HREF` (digits + `+` for
      `tel:`), `CONTACT_LOCATION`, `CONTACT_ADDRESS` (parts, for `PostalAddress`)

## 2. Home page

- [x] Delete the `how` / `example` / `sample` / `dashboard` sections and the `faq` one
- [x] Delete `STEPS`, `FAQ`, the curl string, `sampleDesign` / `sampleHtml` and the
      imports that went with them (`CodeBlock`, `TEMPLATES`, `DEFAULT_TEMPLATE_ID`,
      `renderPreviewHtml`)
- [x] Drop `FAQPage` from the JSON-LD `@graph` — it moved with the copy
- [x] CTA points at `/contact` instead of a `mailto:`, and names the FAQ there
- [x] Remove the CSS the deleted sections owned (`.step-list`, `.step-number`,
      `.sample-mail`, `.dash-preview`, `.sample-caption`, and the `.step-list li`
      mobile rule)

## 3. `/contact`

- [x] `src/app/contact/page.tsx` — details (email / phone / address), form, FAQ;
      `ContactPage` + `Organization` + `FAQPage` JSON-LD
- [x] `src/app/contact/ContactForm.tsx` — name / email / subject / message, off-screen
      `company_url` honeypot, `elapsed_ms` from a mount-time ref, error codes mapped to
      sentences
- [x] `src/app/api/contact/route.ts` — `readLimitedBody` → bot signals → strict `zod`
      → content score → per-IP claim (`429`) → per-body claim (`200 { duplicate }`) →
      `sendMail` to `CONTACT_EMAIL` with `Reply-To`; both claims released on `502`
- [x] `.contact-layout` / `.contact-details` / `.honeypot` CSS
- [x] Header nav (signed-in and signed-out) + footer link

## 4. `/v1/send` returns `200`

- [x] `src/lib/send-endpoint.ts` — both `corsJson` statuses + the four comments (the
      pipeline moved here out of `src/app/api/v1/send/route.ts` when the attachment
      endpoint was added, and both routes now answer `200`)
- [x] `src/lib/dedupe.ts` comments, `src/lib/api-docs.ts` (feeds `/docs`, `/docs.md`,
      `/llms.txt`), `README.md`, `docs/SPEC.md`, `CLAUDE.md`
- [ ] **Tell the live consumer** (`vmcn.satz.co.in`): anything comparing
      `status === 202` breaks; `res.ok` is unaffected

## 5. SEO

- [x] `src/lib/seo.ts` — `privateMetadata(title, description?)`, one `noindex` rule
- [x] Applied to `dashboard`, `admin`, `admin/apps`, `admin/logs`, `admin/users`,
      `verify-email`
- [x] `layout.tsx` for `login`, `register`, `forgot-password`, `reset-password` — a
      `"use client"` page cannot export `metadata`
- [x] `robots.ts` allows `/contact`; `sitemap.ts` lists it

## 6. Docs

- [x] `docs/SPEC.md` §5b — new `/` section list, `/contact` and its endpoint's guard
      order, route table, per-page crawl policy
- [x] `CLAUDE.md` — landing-page paragraph rewritten, `/contact` + `/api/contact` +
      `seo.ts` described
- [x] `README.md` — help-form paragraph, project layout, `200` statuses
- [x] `CLAUDE.md` / `README.md` — dangling links to `HARDENING_ROADMAP.md` and
      `MAIL_TEMPLATES_SPEC.md` removed (the user deleted both mid-task)
- n/a `docs/HARDENING_ROADMAP.md` §1.2 item 4 (a fourth, unauthenticated mail-sending
      route) — file deleted, so the note has nowhere to live

## Review

**What changed.** `/` is now hero → live-on → audience → features → what-it-isn't →
CTA. `/contact` is new and public: details, help form, FAQ. `/v1/send` answers `200`.
Every page carries metadata, and every private one a `noindex`.

**Judgement calls.**

- The contact endpoint reuses `bot-guard`, `spam-score` and `dedupe` rather than
  growing its own rules, and writes **no** `SendLog` row — that model is one row per
  app send (`appId` + `userId` both required) and neither exists for a contact message,
  so no collection was added and no migration is needed.
- The per-IP claim falls back to a shared bucket when no proxy header is present. That
  throttles rather than opens, which is the safe way to be wrong for a form this quiet;
  behind `deploy/nginx.conf` the header is always set.
- `200` is defensible on the merits — the route awaits the provider before answering —
  but it is a breaking change for a client comparing `202`, which is why the item in §4
  is still open.
- CSS the deleted sections owned was removed rather than left orphaned; nothing else
  referenced those classes.

**Verification.** `npx tsc --noEmit` clean; `npm run build` clean, with `/contact` and
`/api/contact` in the route table. Not exercised at runtime — the user asked for a
build check only, so the guard paths (honeypot, too-fast, spam, duplicate, throttle)
and a real send through the form are still unproven end to end.
