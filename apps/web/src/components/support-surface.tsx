import { SupportLinkList } from "@/components/support-link-list";
import type { AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";

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

      <SupportLinkList locale={locale} />
    </main>
  );
};
