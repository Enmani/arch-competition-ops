/**
 * Footer entries for the legal texts a paid plan needs (Stripe asks for terms, a refund policy
 * and a privacy notice on the site). The texts are the owner's to write; until a page exists its
 * `href` stays null and the entry is not rendered, so no link leads nowhere. Set the href (a
 * locale-independent path such as "/terms", or an absolute URL) when the page is published.
 */
export type LegalLinkId = "privacy" | "refund" | "terms";

export const LEGAL_LINKS: readonly { href: string | null; id: LegalLinkId }[] = [
  { href: null, id: "terms" },
  { href: null, id: "refund" },
  { href: null, id: "privacy" },
];
