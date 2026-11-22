import { SUPPORT_LINKS } from "./support-links";

/**
 * Who runs the site, in one place. The Terms, Privacy and Refund pages read these values; an
 * optional field that is null is simply not shown, so visitors never see a placeholder.
 *
 * Countries are ISO 3166-1 alpha-2 codes, shown in the reader's language through
 * `Intl.DisplayNames`. `governingLaw` is the law named in the Terms; it is a business and legal
 * choice of the owner, change it here only.
 */
export type Operator = {
  /** Postal address for legal notices. */
  address: string | null;
  contactEmail: string;
  /** Country of residence or establishment; "IT" also names the Italian data protection authority. */
  country: string | null;
  governingLaw: string;
  /** An individual running a public-interest project, not a company. */
  kind: "individual";
  name: string;
  /** VAT number (P.IVA) or other tax id, once one exists. */
  taxId: string | null;
};

const contactEmail = () => {
  const mail = SUPPORT_LINKS.find((link) => link.href.startsWith("mailto:"));
  if (!mail) {
    throw new Error("SUPPORT_LINKS needs a mailto: entry; the legal pages name it as the contact address.");
  }
  return mail.href.slice("mailto:".length);
};

export const OPERATOR: Operator = {
  address: null,
  contactEmail: contactEmail(),
  country: null,
  governingLaw: "IT",
  kind: "individual",
  name: "Enmani",
  taxId: null,
};
