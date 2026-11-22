import type { Metadata } from "next";

import { LegalPlanTable } from "@/components/legal-extras";
import { LegalDocument } from "@/components/legal-document";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { fillSections, formatLegalUpdated, legalPlanRows, legalValues } from "@/lib/legal-content";
import { composePageMetadata } from "@/lib/page-metadata";

type TermsPageProps = { params: Promise<{ locale: string }> };

export const generateMetadata = async ({ params }: TermsPageProps): Promise<Metadata> => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  const copy = getDictionary(locale).legal.terms;
  return composePageMetadata({ description: copy.description, locale, path: "/terms", title: copy.title });
};

const TermsPage = async ({ params }: TermsPageProps) => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  const dictionary = getDictionary(locale);
  const copy = dictionary.legal.terms;
  const plans = (
    <LegalPlanTable
      columns={dictionary.mcp.pricing.columns}
      planLabel={dictionary.legal.planColumn}
      rows={legalPlanRows(locale, dictionary.mcp)}
    />
  );
  const sections = fillSections(copy.sections, legalValues(locale)).map((section) =>
    section.id === "plans" ? { ...section, extra: plans } : section,
  );

  return (
    <LegalDocument
      lede={copy.lede}
      sections={sections}
      title={copy.title}
      tocLabel={dictionary.legal.toc}
      updated={formatLegalUpdated(locale, dictionary.legal.updated)}
    />
  );
};

export default TermsPage;
