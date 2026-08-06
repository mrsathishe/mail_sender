"use client";

import { CodeBlock } from "@/components/CodeBlock";
import { integrationSnippets } from "@/lib/snippets";
import type { AppField } from "@/lib/fields";
import type { SpamGuard } from "@/lib/bot-guard";
import type { AttachmentConfig } from "@/lib/attachments";

// Copy-paste integration code for one app, built from the field list, guard names and
// attachment setting that app actually has. The generic example in the public docs is
// right until an owner renames a field, after which it produces `400 unknown_field` and
// looks like our bug — so this is generated per app rather than written once.
//
// It reflects the **saved** configuration, which is why it is its own panel rather than
// part of the fields editor: code for fields that were never saved would be code the
// endpoint rejects.
export function CodeSnippets({
  endpoint,
  fields,
  spamGuard,
  attachments,
}: {
  endpoint: string;
  fields: AppField[];
  spamGuard: SpamGuard;
  attachments: AttachmentConfig;
}) {
  const snippets = integrationSnippets({ endpoint, fields, spamGuard, attachments });

  return (
    <div className="snippets">
      <p className="muted field-help">
        Generated from this app&rsquo;s own fields
        {attachments.enabled ? ", with attachments" : ""}
        {spamGuard.honeypotField || spamGuard.minSubmitSeconds > 0
          ? " and its spam-guard fields"
          : ""}
        . Runnable as it stands: the only thing to fill in is{" "}
        <code>YOUR_SECRET_KEY</code> — from an environment variable if you have somewhere
        server-side to hold it. Change the fields here and the code below changes with them.
      </p>

      {snippets.map((snippet) => (
        <div key={snippet.id} className="snippet">
          <h4>{snippet.label}</h4>
          <CodeBlock code={snippet.code} />
        </div>
      ))}
    </div>
  );
}
