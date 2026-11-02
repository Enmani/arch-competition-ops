import type { AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { SUPPORT_LINKS } from "@/lib/support-links";

type SupportSurfaceProps = {
  dictionary: AppDictionary;
  locale: AppLocale;
};

export const SupportSurface = ({ dictionary, locale }: SupportSurfaceProps) => {
  const copy = dictionary.support;

  return (
    <main className="support-page">
      <h1>{copy.title}</h1>

      <div className="support-letter">
        <p className="support-greeting">{copy.greeting}</p>
        {copy.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p className="support-signature">{copy.signature}</p>
      </div>

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
    </main>
  );
};
