import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { baseUrlFrom } from "@/lib/base-url";
import { env } from "@/lib/env";
import { BRAND_FULL, BRAND_TAGLINE, CONTACT_EMAIL } from "@/lib/brand";
import { TEMPLATE_LIST, DEFAULT_TEMPLATE_ID, TEMPLATES, renderPreviewHtml } from "@/lib/templates";
import { DEFAULT_FIELDS } from "@/lib/fields";
import { CodeBlock } from "./docs/CodeBlock";
// Statically imported so next/image knows the intrinsic size at build time and the
// hero cannot shift while it loads.
import logoLockup from "../../public/logo-lockup.png";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // The one page whose title should not be suffixed — it already reads as the
  // brand's own headline.
  title: { absolute: `${BRAND_FULL} — form-to-email API for any website` },
  description: BRAND_TAGLINE,
  alternates: { canonical: "/" },
};

// Sites known to be sending through the service. Add an entry only once the site
// is actually live on it — a wall of aspirational names is worse than a short one.
// Logos are copied into public/logos/ rather than hotlinked: the source asset path
// (vmcn's is main-logo-DQPl96Cb.jpg) carries a build hash that changes on that
// site's next deploy, and a third party's server is not ours to depend on.
const USED_BY = [
  {
    name: "VM Computers and Networking",
    domain: "vmcn.satz.co.in",
    url: "https://vmcn.satz.co.in",
    logo: "/logos/vmcn.jpg",
    note: "Website form submissions delivered straight to the owner's inbox.",
  },
];

const AUDIENCES = [
  {
    title: "Static sites",
    body: "Astro, Hugo, Eleventy, plain HTML or a Next.js export. Nothing to host, no database, no form service to log into — the submission arrives as an email.",
  },
  {
    title: "Small business contact forms",
    body: "An enquiry form whose submissions need to reach a real person, on whatever inbox that person already reads all day.",
  },
  {
    title: "Side projects and prototypes",
    body: "A waitlist, a feedback box, a bug report form. Wire it up in an afternoon and delete it just as easily — no plan to cancel.",
  },
];

// Said plainly rather than discovered after signing up: the shared sending mailbox
// is what makes the free tier possible, and it is not a bulk-mail relay.
const NOT_FOR = [
  "Newsletters, campaigns or any mail to a list of recipients — every send goes to the one confirmed destination for that app.",
  "Transactional email for your own users (receipts, password resets). The sender is always our address, not your domain.",
  "Marketing blasts or cold outreach. Submissions come from a form somebody filled in on your site, which is what keeps the sending domain trusted.",
  "Attachments and file uploads. Submissions are text fields only.",
];

const STEPS = [
  {
    title: "Register your app",
    body: "Create an account, add your website and the inbox that should receive its submissions. We email that address a code to confirm it agreed to receive them.",
  },
  {
    title: "Copy the secret key",
    body: "Each app gets one key, shown once. Keep it on your server and rotate it whenever you like — the old one stops working immediately.",
  },
  {
    title: "POST your form",
    body: "One authenticated request per submission. We format it into an email, set Reply-To to whoever filled the form, and deliver it to your inbox.",
  },
];

const FEATURES = [
  {
    title: "Any inbox, any provider",
    body: "Gmail, Zoho, Outlook or your own domain. Mail is sent from our account and replies go to the person who filled the form, so nothing fails DMARC.",
  },
  {
    title: "Fields you define",
    body: `Declare exactly which fields an app accepts — the default is ${DEFAULT_FIELDS.map((f) => f.name).join(", ")}. Anything undeclared is rejected, so a leaked key can't be used to mail arbitrary content.`,
  },
  {
    title: `${TEMPLATE_LIST.length} mail designs`,
    body: "Pick how submissions look in the inbox and switch any time. Every design is table-based inline HTML with a plain-text alternative, so it survives every mail client.",
  },
  {
    title: "No SDK, no lock-in",
    body: "A single HTTP endpoint that takes JSON or a form post. Works from a static site, a serverless function, a shell script or curl.",
  },
  {
    title: "Confirmed destinations only",
    body: "An address has to confirm by code before anything is delivered to it, so the service can never be pointed at an inbox that never asked for the mail.",
  },
  {
    title: "Sensible limits, published",
    body: `Each app may send ${env.appDailySendLimit} emails a day — far more than a contact form needs, and stated up front rather than discovered. Identical submissions within a minute are collapsed, so a double-clicked submit button never doubles an email.`,
  },
  {
    title: "Every attempt logged",
    body: "Successes and failures are recorded with the mail server's own response, so a missing email is something you can actually diagnose.",
  },
];

const FAQ = [
  {
    q: "What does it cost?",
    a: "Nothing. It sends through one mailbox we already pay for, which is exactly why there is a published daily cap per app and why it carries form submissions only — not newsletters, and not transactional mail for your own users.",
  },
  {
    q: "Do I need a server to use it?",
    a: "You need somewhere server-side to hold the key — a serverless function, a small API route, or your host's form handler. The key travels in a request header, which a plain HTML form can't set, and anything in page JavaScript is readable by anyone. A static site works fine: it posts to a small route of its own that forwards the submission.",
  },
  {
    q: "How many emails can I send?",
    a: `${env.appDailySendLimit} a day per app, on the UTC day, reset at midnight. Past that, submissions are refused with a 429 rather than dropped silently. It's a limit we can raise — email us if your form legitimately needs more.`,
  },
  {
    q: "Which email address does the mail come from?",
    a: "Always ours. The person who filled in your form goes into Reply-To instead, because sending as a stranger's address is spoofing and fails SPF and DMARC checks.",
  },
  {
    q: "Can I send to an address I don't own?",
    a: "Only if that address confirms it. We email it an eight-character code, and until the code is entered the app has no working secret key at all.",
  },
  {
    q: "What happens if a submission has a field I didn't declare?",
    a: "It is rejected with a 400 and the offending field name, and no email is sent. Add the field to the app in the dashboard and the same request succeeds.",
  },
];

// Every block below is the same shape: an eyebrow label naming the section, the
// heading it is labelled by, then content. One component so a new section cannot
// forget `aria-labelledby` or drift from the others' spacing.
function Section({
  id,
  label,
  title,
  children,
}: {
  id: string;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="landing-section" aria-labelledby={id}>
      <p className="section-label">{label}</p>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export default async function Home() {
  // Signed-in visitors have no use for the pitch — but the page still renders for
  // crawlers and first-time visitors, which is what makes the site indexable.
  const session = await getSession();
  if (session) redirect("/dashboard");

  const base = baseUrlFrom(await headers());
  const example = `curl -X POST ${base}/api/v1/send \\
  -H "Authorization: Bearer YOUR_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Jane Doe","email":"jane@example.com","message":"Hello!"}'`;

  // The same sample the dashboard picker shows, rendered here rather than fetched
  // from /api/templates/[id]/preview — that route is for signed-in users, and this
  // page's whole job is to work before anyone has an account. srcDoc keeps it inert:
  // sandbox="" means no scripts, no forms and no network from inside the frame.
  const sampleDesign = TEMPLATES[DEFAULT_TEMPLATE_ID];
  const sampleHtml = renderPreviewHtml(DEFAULT_TEMPLATE_ID);

  // Structured data mirrors what is visible on the page — describing content that
  // isn't here is what gets rich results revoked.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        url: `${base}/`,
        name: BRAND_FULL,
        description: BRAND_TAGLINE,
        inLanguage: "en",
      },
      {
        "@type": "SoftwareApplication",
        name: BRAND_FULL,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Any",
        url: `${base}/`,
        description: BRAND_TAGLINE,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };

  return (
    <div className="wrap landing">
      {/* Built from the constants above, never from a request or the database. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="hero">
        {/* The full designed lockup, which already sets the brand name in type — so
            the header keeps the compact mark plus live text and this is the one place
            the wordmark appears as artwork. next/image serves AVIF/WebP derivatives:
            the source PNG is 441KB of gold gradient, far too heavy to ship as-is. */}
        <Image
          className="hero-logo"
          src={logoLockup}
          alt={BRAND_FULL}
          width={196}
          height={180}
          priority
        />
        <h1>Your website&rsquo;s forms, in your inbox.</h1>
        <p className="hero-lede">{BRAND_TAGLINE}</p>
        <div className="hero-actions">
          <Link className="btn-primary" href="/register">
            Create a free account
          </Link>
          <Link className="btn-secondary" href="/docs">
            Read the API docs
          </Link>
        </div>
        <p className="muted">No SDK to install. One endpoint, one secret key per site.</p>
        <p className="hero-price">
          Free · {env.appDailySendLimit} emails a day per app · no card, no plan to cancel
        </p>
      </section>

      <Section id="used-by" label="Customers" title="Live on">
        <ul className="used-by-grid">
          {USED_BY.map((site) => (
            <li className="used-by-card" key={site.domain}>
              {/* Plain <img>, not next/image: these are third-party marks dropped into
                  public/ without known intrinsic dimensions, and alt is empty because
                  the site name is announced by the link right below it. */}
              <img className="used-by-logo" src={site.logo} alt="" loading="lazy" />
              <a href={site.url} target="_blank" rel="noopener">
                {site.name}
              </a>
              <span className="used-by-domain">{site.domain}</span>
              <span>{site.note}</span>
            </li>
          ))}
        </ul>
        <p className="muted">
          Sending through {BRAND_FULL} and happy to be listed?{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>Tell us</a> and we&rsquo;ll add your site.
        </p>
      </Section>

      <Section id="who" label="Audience" title="Who it’s for">
        <div className="feature-grid">
          {AUDIENCES.map((a) => (
            <div className="feature-card" key={a.title}>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="how" label="Getting started" title="How it works">
        <ol className="step-list">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="step-number" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="example" label="Integration" title="One request per submission">
        <CodeBlock code={example} />
        <p>
          A <code>202</code> means the email is on its way. Full reference, response
          codes and a live tester are in the <Link href="/docs">API documentation</Link>.
        </p>
      </Section>

      <Section id="sample" label="Mail designs" title="What lands in your inbox">
        <p className="sample-caption">
          The <strong>{sampleDesign.name}</strong> design, one of{" "}
          {TEMPLATE_LIST.length}, rendered from the request above. Nested values and
          longer messages are laid out for you; every field you declared appears in the
          order you declared it, even the ones left blank.
        </p>
        <div className="sample-mail">
          <iframe
            title={`Sample email in the ${sampleDesign.name} design`}
            srcDoc={sampleHtml}
            // Per-design height (lib/templates.ts): under sandbox="" the frame cannot
            // measure or report its own content height.
            style={{ height: `${sampleDesign.previewHeight}px` }}
            sandbox=""
            loading="lazy"
          />
        </div>
      </Section>

      <Section id="features" label="Features" title="What you get">
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="dashboard" label="Dashboard" title="Every site in one dashboard">
        <p className="sample-caption">
          Each app keeps its own destination, field list and design. This is how one
          looks once its address is confirmed — the real row also carries buttons to edit
          the fields, switch design and rotate the key.
        </p>
        {/* Deliberately the dashboard's own .app-item markup and classes rather than a
            screenshot: a picture goes stale silently, this restyles with the real UI.
            Interactive controls are left out instead of rendered as dead buttons. */}
        <div className="dash-preview" aria-label="Example of a registered app">
          <div className="app-item">
            <div className="app-item-head">
              <div>
                <h3>Acme contact form</h3>
                <p>
                  → support@acme.com <span className="status-ok">confirmed</span>
                </p>
                <p>Design: {sampleDesign.name}</p>
                <p>
                  Fields:{" "}
                  {DEFAULT_FIELDS.map((f, i) => (
                    <span key={f.name}>
                      {i > 0 && ", "}
                      <code>{f.name}</code>
                      {f.required && <abbr title="required">*</abbr>}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section id="not-for" label="Scope" title="What it isn’t">
        <ul className="limits-list">
          {NOT_FOR.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section id="faq" label="FAQ" title="Questions">
        <dl className="faq-list">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <section className="landing-cta">
        <h2>Ready to wire up your form?</h2>
        <p>
          Register an app, copy its key, and post your first submission in a couple of
          minutes.
        </p>
        <div className="hero-actions">
          <Link className="btn-primary" href="/register">
            Get started
          </Link>
          <a className="btn-secondary" href={`mailto:${CONTACT_EMAIL}`}>
            Ask a question
          </a>
        </div>
      </section>
    </div>
  );
}
