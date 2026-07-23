import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { LogoutButton } from "../dashboard/LogoutButton";
import { CodeBlock } from "./CodeBlock";
import { TrySend } from "./TrySend";

export const dynamic = "force-dynamic";

export default async function DocsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Build the public base URL from the forwarded headers nginx sets, so the
  // examples show the real domain (e.g. https://mail.satz.co.in), not localhost.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = `${proto}://${host}`;
  const endpoint = `${base}/api/v1/send`;

  const curlExample = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer YOUR_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Jane Doe","email":"jane@example.com","message":"Hello!"}'`;

  const fetchExample = `await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_SECRET_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Jane Doe",
    email: "jane@example.com",
    message: "Hello!",
  }),
});`;

  const formExample = `<form id="contact">
  <input name="name" placeholder="Your name" required />
  <input name="email" type="email" placeholder="Your email" required />
  <textarea name="message" placeholder="Message" required></textarea>
  <button type="submit">Send</button>
</form>

<script>
  document.getElementById("contact").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const res = await fetch("${endpoint}", {
      method: "POST",
      headers: {
        "Authorization": "Bearer YOUR_SECRET_KEY",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    alert(res.ok ? "Sent!" : "Failed to send");
  });
</script>`;

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1 style={{ margin: 0 }}>API documentation</h1>
          <span className="muted">{session.email}</span>
        </div>
        <div className="topbar-actions">
          <Link href="/dashboard">Dashboard</Link>
          {session.role === "admin" && <Link href="/admin">Admin</Link>}
          <LogoutButton />
        </div>
      </div>

      <div className="doc-section">
        <h2>Overview</h2>
        <p>
          Send your website&rsquo;s form submissions to a Gmail inbox with a single
          HTTP request. First register an app on the{" "}
          <Link href="/dashboard">dashboard</Link> to get a <strong>secret key</strong>{" "}
          and set the destination Gmail. Then call the endpoint below with that key.
        </p>
        <div className="endpoint">
          <span className="method-badge">POST</span>
          <span>{endpoint}</span>
        </div>
      </div>

      <div className="doc-section">
        <h2>Authentication</h2>
        <p>
          Pass your secret key as a Bearer token in the <code>Authorization</code>{" "}
          header. Keep it on your server — never expose it in public client-side code
          you don&rsquo;t control. A missing or wrong key returns <code>401</code>.
        </p>
        <CodeBlock code={`Authorization: Bearer YOUR_SECRET_KEY`} />
      </div>

      <div className="doc-section">
        <h2>Request body</h2>
        <p>
          Send a JSON object (or a form post). Every top-level field becomes one{" "}
          <code>Key: value</code> line in the email body. For example{" "}
          <code>{`{ "name": "Jane", "message": "Hi" }`}</code> arrives as:
        </p>
        <CodeBlock code={`Name: Jane\nMessage: Hi`} />
      </div>

      <div className="doc-section">
        <h2>Responses</h2>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>202</code></td>
              <td>Accepted — the email was sent to the configured Gmail.</td>
            </tr>
            <tr>
              <td><code>400</code></td>
              <td>Empty or invalid body.</td>
            </tr>
            <tr>
              <td><code>401</code></td>
              <td>Secret key missing or invalid.</td>
            </tr>
            <tr>
              <td><code>502</code></td>
              <td>The mail server failed to send.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="doc-section">
        <h2>Examples</h2>
        <p><strong>cURL</strong></p>
        <CodeBlock code={curlExample} />
        <p style={{ marginTop: "1rem" }}><strong>JavaScript (fetch)</strong></p>
        <CodeBlock code={fetchExample} />
        <p style={{ marginTop: "1rem" }}><strong>HTML form</strong></p>
        <CodeBlock code={formExample} />
      </div>

      <div className="doc-section">
        <h2>Try it</h2>
        <p>
          Paste one of your app&rsquo;s secret keys and a JSON payload, then send a
          real test email to that app&rsquo;s destination Gmail.
        </p>
        <TrySend endpoint={endpoint} />
      </div>
    </div>
  );
}
