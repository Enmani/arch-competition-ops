import type { AppLocale } from "@/i18n/config";
import { SUPPORT_LINKS } from "@/lib/support-links";

/** The ways to reach or support the project, one ruled row each; used by the Support and About pages. */
export const SupportLinkList = ({ locale }: { locale: AppLocale }) => (
  <ul className="support-links">
    {SUPPORT_LINKS.map((link) => {
      const external = link.href.startsWith("http");
      const label = typeof link.label === "string" ? link.label : link.label[locale];

      return (
        <li key={link.href}>
          <a
            className="support-link"
            href={link.href}
            rel={external ? "noreferrer" : undefined}
            target={external ? "_blank" : undefined}
          >
            <span className="support-link-label">{label}</span>
            <span className="support-link-value">{link.value}</span>
          </a>
        </li>
      );
    })}
  </ul>
);
