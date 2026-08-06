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
import { TEMPLATE_LIST } from "@/lib/templates";
import { DEFAULT_FIELDS } from "@/lib/fields";
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
    body: "Nothing to host, no database, no form service to log into — the submission arrives as an email.",
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
  "Companies sending newsletters, ad campaigns or marketing blasts. Every send goes to the one confirmed destination for that app, never to a list of recipients.",
  `Anyone who needs a large volume of mail in a day. Each app is capped at ${env.appDailySendLimit} emails a day — we will raise it for a form that genuinely needs more, but not to the point of a bulk sender.`,
  "Products sending transactional email to their own users — receipts, password resets, alerts. The sender is always our address, not your domain.",
  "Cold outreach. A submission has to come from a form somebody actually filled in on your site.",
];

const FEATURES = [
  {
    title: "Any inbox, any provider",
    body: "Gmail, Zoho, Outlook or your own domain. Mail is sent from our account and replies go to the person who filled the form.",
  },
  {
    title: "Fields you define",
    body: `Declare exactly which fields an app accepts — the default is ${DEFAULT_FIELDS.map((f) => f.id).join(", ")}. Anything undeclared is rejected, so a leaked key can't be used to mail arbitrary content.`,
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
  {
    // Accurate as written: a delivered submission leaves no copy behind. The only rows
    // that keep anything content-derived are the blocked ones — the words the spam
    // filter matched, or a refused file's name — so the claim is scoped to delivery.
    title: "Nothing delivered is stored",
    body: "The submission is rendered, emailed and dropped. The log keeps the status, the time and the mail server's reply — never the fields you received. Only a blocked submission records what triggered the block.",
  },
];

// Decorative list markers. SVG rather than a "✓"/"✕" character: generated content is
// exposed to the accessibility tree, so a glyph marker gets announced ("check mark") once
// per point, and dingbats render differently in every font. `currentColor` lets one shape
// serve both themes.
function TickIcon() {
  return (
    <svg className="point-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg className="point-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M5 5 11 11M11 5 5 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Every block below is the same shape: an optional eyebrow label, an optional heading,
// then content. One component so a new section cannot forget `aria-labelledby` or drift
// from the others' spacing. The label is omitted where the heading already says
// everything an eyebrow would ("Who it's for" / "Who it's not for") — repeating it there
// is noise, not structure. One of the two has to be present, because whichever it is
// carries the `id` that names the section: drop both and the section has no accessible
// name at all.
function Section({
  id,
  label,
  title,
  children,
}: {
  id: string;
  label?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <section
      // Without a heading the eyebrow has to carry the h2's bottom margin, or the block
      // sits tighter than every other section.
      className={title ? "landing-section" : "landing-section landing-section-unheaded"}
      aria-labelledby={id}
    >
      {label ? (
        <p className="section-label" id={title ? undefined : id}>
          {label}
        </p>
      ) : null}
      {title ? <h2 id={id}>{title}</h2> : null}
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

  // Structured data mirrors what is visible on the page — describing content that
  // isn't here is what gets rich results revoked. The `FAQPage` node moved to
  // /contact with the questions themselves, for that reason.
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
        <h1>Contact form, feedback form, whatever the form &mdash; in your inbox.</h1>
        <p className="hero-lede">{BRAND_TAGLINE}</p>
        <div className="hero-actions">
          <Link className="btn-primary" href="/register">
            Create a free account
          </Link>
          <Link className="btn-secondary" href="/docs">
            Read the API docs
          </Link>
        </div>
        <p className="hero-price">
          Free · {env.appDailySendLimit} emails a day per app · no card, no plan to cancel
        </p>
      </section>

      <Section id="who" title="Who it’s for">
        <div className="feature-grid">
          {AUDIENCES.map((a) => (
            <div className="feature-card" key={a.title}>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Points rather than cards: these are things to read down and tick off, and a
          grid of eight competed with the three-card "Who it's for" above it for the same
          visual weight. Ticks rather than bullets for the same reason `.limits-list`
          below crosses its items — the marker carries the sense, so the two lists don't
          read as one undifferentiated wall. */}
      <Section id="features" label="Features" title="What you get">
        <ul className="check-list">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <TickIcon />
              <span>
                <strong>{f.title}</strong> — {f.body}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="not-for" title="Who it’s not for">
        <ul className="limits-list">
          {NOT_FOR.map((item) => (
            <li key={item}>
              <CrossIcon />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Last of the content sections on purpose: proof reads better after the pitch it
          is proof of, and a one-entry list is not a headline. */}
      <Section id="used-by" label="Clients">
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

      <section className="landing-cta">
        <h2>Ready to wire up your form?</h2>
        <p>
          Register an app, copy its key, and post your first submission in a couple of
          minutes. The <Link href="/docs">API docs</Link> carry the full reference, and{" "}
          <Link href="/contact">contact</Link> has the answers to the questions people
          ask first.
        </p>
        <div className="hero-actions">
          <Link className="btn-primary" href="/register">
            Get started
          </Link>
          <Link className="btn-secondary" href="/contact">
            Ask a question
          </Link>
        </div>
      </section>
    </div>
  );
}
