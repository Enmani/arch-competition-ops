import Link from "next/link";

import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { fillTemplate } from "@/i18n/format";
import { COOKIES_PATH, LEGAL_LINKS } from "@/lib/legal-links";
import { OPERATOR } from "@/lib/operator";

type SiteFooterProps = {
  copy: AppDictionary["legal"];
  locale: AppLocale;
  year: number;
};

/**
 * One muted line under every page except discover and the opportunity pages (the shell decides
 * where it shows): copyright, About, the legal pages and the cookie section.
 */
export const SiteFooter = ({ copy, locale, year }: SiteFooterProps) => {
  const links = [
    { href: "/about", label: copy.links.about },
    ...LEGAL_LINKS.map((link) => ({ href: link.href, label: copy.links[link.id] })),
    { href: COOKIES_PATH, label: copy.links.cookies },
  ];

  return (
    <footer className="site-footer">
      <span>{fillTemplate(copy.footer.copyright, { name: OPERATOR.name, year })}</span>
      <nav aria-label={copy.footer.label}>
        <ul>
          {links.map((link) => (
            <li key={link.href}>
              <Link href={buildLocalePath(locale, link.href)}>{link.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
};
