// Brand constants shared by the site chrome, metadata and generated images.
// Kept in one module so the name, tagline and contact address can never drift
// between the header, the footer, the OG card and the docs.

export const BRAND_NAME = "Mailer";
export const BRAND_SUFFIX = "by satz";
/** The full lockup, as used in <title>, the header and structured data. */
export const BRAND_FULL = `${BRAND_NAME} ${BRAND_SUFFIX}`;

export const BRAND_TAGLINE =
  "Send website form submissions to any email inbox with a single authenticated HTTP request.";

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

/** Palette echoed by the generated images, which cannot read the site CSS. */
export const BRAND_COLORS = {
  gold: "#D4AF37",
  goldLight: "#F9D976",
  red: "#C8102E",
  black: "#1a1a1a",
  cream: "#f8ebab",
} as const;
