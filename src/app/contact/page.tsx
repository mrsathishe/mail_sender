import Link from "next/link";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { baseUrlFrom } from "@/lib/base-url";
import { env } from "@/lib/env";
import {
  BRAND_FULL,
  BRAND_TAGLINE,
  CONTACT_ADDRESS,
  CONTACT_EMAIL,
  CONTACT_LOCATION,
  CONTACT_PHONE,
  CONTACT_PHONE_HREF,
} from "@/lib/brand";
import { ContactForm } from "./ContactForm";

export const dynamic = "force-dynamic";

const TITLE = "Contact";
const DESCRIPTION = `Reach ${BRAND_FULL} by form, email or phone, and read the answers to the questions people ask first.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/contact" },
  openGraph: { title: `${TITLE} · ${BRAND_FULL}`, description: DESCRIPTION, url: "/contact" },
};

// Moved here from the landing page: somebody with a question lands on this page, not
// on the pitch. The `FAQPage` structured data below moved with it, because the JSON-LD
// has to mirror the copy that is actually visible.
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
    a: `${env.appDailySendLimit} a day per app, on the UTC day, reset at midnight. Past that, submissions are refused with a 429 rather than dropped silently. It's a limit we can raise — ask us if your form legitimately needs more.`,
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

export default async function ContactPage() {
  const base = baseUrlFrom(await headers());

  // The one place the business itself is described, so there is a single
  // `Organization` node rather than a copy per page.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ContactPage",
        "@id": `${base}/contact#page`,
        url: `${base}/contact`,
        name: `${TITLE} · ${BRAND_FULL}`,
        description: DESCRIPTION,
        inLanguage: "en",
      },
      {
        "@type": "Organization",
        "@id": `${base}/#organization`,
        name: BRAND_FULL,
        url: `${base}/`,
        description: BRAND_TAGLINE,
        logo: `${base}/logo-lockup.png`,
        email: CONTACT_EMAIL,
        telephone: CONTACT_PHONE,
        address: {
          "@type": "PostalAddress",
          addressLocality: CONTACT_ADDRESS.locality,
          addressRegion: CONTACT_ADDRESS.region,
          addressCountry: CONTACT_ADDRESS.country,
        },
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: CONTACT_EMAIL,
          telephone: CONTACT_PHONE,
          areaServed: "Worldwide",
          availableLanguage: ["English", "Tamil"],
        },
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
    <div className="wrap">
      {/* Built from the constants above, never from a request or the database. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <PageHeader
        title="Contact"
        subtitle="Questions about an integration, a limit you need raised, or anything else — write to us."
      />

      <div className="contact-layout">
        <div className="card card-wide contact-details">
          <h2>Reach us directly</h2>
          <dl>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </dd>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${CONTACT_PHONE_HREF}`}>{CONTACT_PHONE}</a>
            </dd>
            <dt>Address</dt>
            <dd>{CONTACT_LOCATION}</dd>
          </dl>
          <p className="muted">
            If your question is about the endpoint itself, the{" "}
            <Link href="/docs">API documentation</Link> answers most of it — including
            every response code and a live tester.
          </p>
        </div>

        <ContactForm />
      </div>

      <section className="landing-section" aria-labelledby="faq">
        <p className="section-label">FAQ</p>
        <h2 id="faq">Questions</h2>
        <dl className="faq-list">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
