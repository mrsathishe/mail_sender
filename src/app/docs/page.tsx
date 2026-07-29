import { getSession } from "@/lib/auth";
import { headers } from "next/headers";
import Link from "next/link";
import { marked } from "marked";
import { PageHeader } from "@/components/PageHeader";
import { CodeBlock } from "./CodeBlock";
import { TrySend } from "./TrySend";
import { baseUrlFrom } from "@/lib/base-url";
import { docSections, DOCS_TITLE, DOCS_TAGLINE, type DocBlock } from "@/lib/api-docs";

export const dynamic = "force-dynamic";

// Public page: no session required, so an AI agent handed the bare URL can read
// it. `alternates` advertises the markdown mirror to fetchers that land here.
export const metadata = {
  // `absolute` so the root layout's `%s · Mailer by satz` template doesn't repeat
  // the brand that DOCS_TITLE already carries.
  title: { absolute: DOCS_TITLE },
  description: DOCS_TAGLINE,
  alternates: { canonical: "/docs", types: { "text/markdown": "/docs.md" } },
  openGraph: { title: DOCS_TITLE, description: DOCS_TAGLINE, url: "/docs" },
};

// Safe to inject: every string comes from src/lib/api-docs.ts, never from a
// request or the database.
function Prose({ markdown }: { markdown: string }) {
  return <div dangerouslySetInnerHTML={{ __html: marked.parse(markdown, { async: false }) }} />;
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case "prose":
      return <Prose markdown={block.markdown} />;
    case "endpoint":
      return (
        <div className="endpoint">
          <span className="method-badge">{block.method}</span>
          <span>{block.url}</span>
        </div>
      );
    case "code":
      return (
        <>
          {block.label && (
            <p>
              <strong>{block.label}</strong>
            </p>
          )}
          <CodeBlock code={block.code} />
        </>
      );
    case "table":
      return (
        <table className="doc-table">
          <thead>
            <tr>
              {block.headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              // Index key: the status-code column repeats (three different 400s).
              <tr key={r}>
                {row.map((cell, i) => (
                  <td
                    key={i}
                    dangerouslySetInnerHTML={{ __html: marked.parseInline(cell, { async: false }) }}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

export default async function DocsPage() {
  const session = await getSession();
  const base = baseUrlFrom(await headers());

  return (
    <div className="wrap">
      <PageHeader title="API documentation" subtitle={DOCS_TAGLINE} />

      {docSections(base).map((section) => (
        <div className="doc-section" key={section.id}>
          <h2>{section.heading}</h2>
          {section.blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>
      ))}

      <div className="doc-section">
        <h2>Try it</h2>
        {session ? (
          <>
            <p>
              Paste one of your app&rsquo;s secret keys and a JSON payload, then send a
              real test email to that app&rsquo;s destination address.
            </p>
            <TrySend endpoint={`${base}/api/v1/send`} />
          </>
        ) : (
          <p>
            <Link href="/login">Sign in</Link> to send a real test email from this page
            using one of your app&rsquo;s secret keys.
          </p>
        )}
      </div>

      <div className="doc-section">
        <h2>Machine-readable version</h2>
        <p>
          This page is also available as plain markdown for AI agents and scripts:{" "}
          <a href="/docs.md">/docs.md</a> (indexed from <a href="/llms.txt">/llms.txt</a>
          ).
        </p>
      </div>
    </div>
  );
}
