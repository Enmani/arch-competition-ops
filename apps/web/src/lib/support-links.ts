import type { AppLocale } from "@/i18n/config";

export type SupportLink = {
  href: string;
  /** A brand name (PayPal) is one string; a word that differs per language is given for each locale. */
  label: string | Record<AppLocale, string>;
  /** What the visitor reads on the right of the row: an address, a handle, a short URL. */
  value: string;
};

/**
 * The rows of the support page, top to bottom, the same in every language. To add a way to
 * support the project (PayPal, a sponsor page, a payment link), add an entry here; nothing else
 * needs to change.
 */
export const SUPPORT_LINKS: readonly SupportLink[] = [
  {
    href: "mailto:fangxiaoyandi@gmail.com",
    label: { en: "Email", zh: "邮箱" },
    value: "fangxiaoyandi@gmail.com",
  },
  {
    href: "https://github.com/Enmani/arch-competition-ops",
    label: "GitHub",
    value: "Enmani/arch-competition-ops",
  },
];
