import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument } from "@/components/legal-document";
import { OperatorDetails } from "@/components/legal-extras";
import { buildLocalePath } from "@/i18n/config";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { fillSections, formatLegalUpdated, legalValues } from "@/lib/legal-content";
import { COOKIES_PATH } from "@/lib/legal-links";
import { OPERATOR } from "@/lib/operator";
import { composePageMetadata } from "@/lib/page-metadata";

type PrivacyPageProps = { params: Promise<{ locale: string }> };

export const generateMetadata = async ({ params }: PrivacyPageProps): Promise<Metadata> => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  const copy = getDictionary(locale).legal.privacy;
  return composePageMetadata({ description: copy.description, locale, path: "/privacy", title: copy.title });
};

const PrivacyPage = async ({ params }: PrivacyPageProps) => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  const dictionary = getDictionary(locale);
  const { legal } = dictionary;
  const extras: Record<string, React.ReactNode> = {
    controller: <OperatorDetails labels={legal.operator} locale={locale} />,
    // The authority is named only once the operator's country is set (see lib/operator.ts).
    rights: OPERATOR.country === "IT" ? <p>{legal.garante}</p> : null,
    cookies: (
      <p>
        <Link className="inline-link" href={buildLocalePath(locale, COOKIES_PATH)}>
          {legal.cookiesLink}
        </Link>
      </p>
    ),
  };
  const sections = fillSections(legal.privacy.sections, legalValues(locale)).map((section) => ({
    ...section,
    extra: extras[section.id],
  }));

  return (
    <LegalDocument
      lede={legal.privacy.lede}
      sections={sections}
      title={legal.privacy.title}
      tocLabel={legal.toc}
      updated={formatLegalUpdated(locale, legal.updated)}
    />
  );
};

export default PrivacyPage;
