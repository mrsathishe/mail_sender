"use client";

import { useId, useRef, useState } from "react";
import {
  BRAND_FULL,
  DONATE_PAYPAL_HANDLE,
  DONATE_PAYPAL_QR,
  DONATE_PAYPAL_URL,
  DONATE_UPI_ID,
  DONATE_UPI_LINK,
  DONATE_UPI_QR,
} from "@/lib/brand";

// One dialog for every entry point — the header on every page and the dashboard card —
// so the wording and the payment details cannot differ between them, the same reason
// brand.ts exists. It takes no props: the two placements differ only in size, which the
// surrounding CSS decides.
//
// A native <dialog> opened with showModal(): the focus trap, Esc-to-close, inert
// background and top-layer stacking all come from the platform, so none of it is
// re-implemented here. Top layer is also why the sticky header's z-index cannot cover it.
export function DonateDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  // Both placements render on the dashboard at once, so a literal id would be duplicated
  // and `aria-labelledby` would resolve to whichever came first.
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        className="donate-trigger"
        onClick={() => ref.current?.showModal()}
      >
        <Heart />
        Donate
      </button>

      <dialog
        ref={ref}
        className="donate-dialog"
        aria-labelledby={titleId}
        // A click reported by the dialog itself is a click on the backdrop: the inner
        // wrapper covers the whole box, so anything inside names itself as the target.
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="donate-body">
          <h2 id={titleId}>Support this service</h2>
          <p className="donate-intro">
            {BRAND_FULL} is free to use. The sending mailbox and the server behind it are
            funded privately, and a contribution helps keep them running. It is entirely
            voluntary — no limit, feature or level of support depends on one.
          </p>

          {/* Side by side, because the two are alternatives chosen by where the donor is
              rather than steps: whichever applies should be readable without scrolling
              past the other. They stack only below the width two codes need. */}
          <div className="donate-options">
            <section className="donate-option">
              <h3>From outside India</h3>
              <p className="muted donate-method">
                PayPal — by card or PayPal balance, in your own currency.
              </p>
              <QrCode
                src={DONATE_PAYPAL_QR}
                width={636}
                height={700}
                alt={`PayPal QR code for paypal.me/${DONATE_PAYPAL_HANDLE}`}
              />
              <a
                className="btn-primary donate-action"
                href={DONATE_PAYPAL_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open PayPal
              </a>
              <Handle value={`paypal.me/${DONATE_PAYPAL_HANDLE}`} copy={DONATE_PAYPAL_URL} />
            </section>

            <section className="donate-option">
              <h3>From within India</h3>
              <p className="muted donate-method">
                UPI — Google Pay, PhonePe, Paytm or any other UPI application.
              </p>
              <QrCode
                src={DONATE_UPI_QR}
                width={522}
                height={700}
                alt={`Google Pay UPI QR code for ${DONATE_UPI_ID}`}
              />
              {/* A `upi://` link hands the id straight to an installed application, which
                  is what the phone showing this dialog needs — it cannot scan its own
                  screen. On a desktop it is the QR that does the work instead. */}
              <a className="btn-primary donate-action" href={DONATE_UPI_LINK}>
                Open a UPI application
              </a>
              <Handle value={DONATE_UPI_ID} copy={DONATE_UPI_ID} />
            </section>
          </div>

          <p className="muted donate-note">
            Contributions are voluntary gifts rather than payment for a service. They are
            non-refundable, and no invoice or tax receipt is issued.
          </p>

          <div className="donate-actions">
            <button type="button" className="link-btn" onClick={() => ref.current?.close()}>
              Close
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** Decorative, so it is hidden from assistive tech — the word beside it already says what
 *  the button does. Inline rather than an emoji: a `❤` renders in the platform's own
 *  glyph and colour, which cannot be held to the palette. */
function Heart() {
  return (
    <svg
      className="donate-heart"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

// Plain <img> rather than next/image: an optimiser round-trip re-encodes lossily, and a
// scannable code is the one asset that cannot afford it. `loading="lazy"` matters more
// than usual here — this dialog is in the markup of every page, and without it both codes
// would be fetched on every page nobody opens the dialog on. Intrinsic dimensions come
// from the files' own pixel sizes, so the columns don't reflow as the codes arrive.
function QrCode(props: { src: string; width: number; height: number; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- see above
  return <img className="donate-qr" loading="lazy" decoding="async" {...props} />;
}

/** The payment address in text, for anyone who would rather read or paste it than trust a
 *  link or a code. The clipboard copy is a convenience only — the value stays selectable
 *  where the API is unavailable (it needs a secure context). */
function Handle({ value, copy }: { value: string; copy: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <p className="donate-handle">
      <span className="donate-handle-value">{value}</span>
      <button
        type="button"
        className="donate-copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(copy);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // clipboard blocked (e.g. non-HTTPS) — the text above is still selectable
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </p>
  );
}
