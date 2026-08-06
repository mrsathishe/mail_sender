// Brand constants shared by the site chrome, metadata and generated images.
// Kept in one module so the name, tagline and contact address can never drift
// between the header, the footer, the OG card and the docs.

export const BRAND_NAME = "Mailer";
export const BRAND_SUFFIX = "by satz";
/** The full lockup, as used in <title>, the header and structured data. */
export const BRAND_FULL = `${BRAND_NAME} ${BRAND_SUFFIX}`;

export const BRAND_TAGLINE =
  "Send website form submissions to any email inbox with a single authenticated HTTP request to our REST API.";

export const CONTACT_EMAIL = "contact@satz.co.in";
export const CONTACT_PHONE = "+91 9790060943";
/** `tel:` takes digits and one leading `+` — spaces stop some clients dialling. */
export const CONTACT_PHONE_HREF = "+919790060943";
export const CONTACT_LOCATION = "Chennai, Tamil Nadu, India";
/** The same place, in the parts `PostalAddress` structured data needs separately. */
export const CONTACT_ADDRESS = {
  locality: "Chennai",
  region: "Tamil Nadu",
  country: "IN",
} as const;

// ── Voluntary contributions ────────────────────────────────────────────────
// Two routes because neither method covers both audiences: UPI exists only inside
// India, and a card from outside it cannot reach a UPI id at all. Nothing in the
// product reads these — no limit, feature or level of support depends on a
// contribution, which is why they live here and not on a `User`.

/** PayPal.Me handle, i.e. the tail of `paypal.me/<handle>`. */
export const DONATE_PAYPAL_HANDLE = "sathish0907";
export const DONATE_PAYPAL_URL = `https://paypal.me/${DONATE_PAYPAL_HANDLE}`;

export const DONATE_UPI_ID = "mrsathishe@okicici";
/** The same id as a deep link. A phone showing the QR cannot scan its own screen, so
 *  this link is what makes the dialog usable on the device most visitors hold; `pn` is
 *  the payee name the UPI app shows on its confirmation screen. */
export const DONATE_UPI_LINK = `upi://pay?pa=${DONATE_UPI_ID}&pn=${encodeURIComponent(
  BRAND_FULL,
)}&cu=INR`;

/** Exported from PayPal and from the Google Pay app rather than re-encoded here, so the
 *  code a donor scans is the one the provider issued — including the payee name printed
 *  on it, which is what tells a donor the code was not swapped. */
export const DONATE_PAYPAL_QR = "/donate-paypal-qr.png";
export const DONATE_UPI_QR = "/donate-upi-qr.png";

/** Palette echoed by the generated images, which cannot read the site CSS. */
export const BRAND_COLORS = {
  gold: "#D4AF37",
  goldLight: "#F9D976",
  red: "#C8102E",
  black: "#1a1a1a",
  cream: "#f8ebab",
} as const;
