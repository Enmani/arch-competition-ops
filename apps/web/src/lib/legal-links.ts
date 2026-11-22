/**
 * The legal pages a paid plan needs (Stripe asks for terms, a refund policy and a privacy
 * notice on the site). One list for the site footer, the About page and the pricing page.
 * Paths are locale-independent; render them with `buildLocalePath(locale, href)`.
 */
export type LegalLinkId = "privacy" | "refund" | "terms";

export const LEGAL_LINKS: readonly { href: `/${LegalLinkId}`; id: LegalLinkId }[] = [
  { href: "/terms", id: "terms" },
  { href: "/privacy", id: "privacy" },
  { href: "/refund", id: "refund" },
];

/** The cookie section of the About page; the footer's "Cookies" link points here. */
export const COOKIES_PATH = "/about#cookies";
