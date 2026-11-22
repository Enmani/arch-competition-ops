import type { Metadata } from "next";

import { LegalDocument } from "@/components/legal-document";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { fillSections, formatLegalUpdated, legalValues } from "@/lib/legal-content";
import { composePageMetadata } from "@/lib/page-metadata";

type RefundPageProps = { params: Promise<{ locale: string }> };

export const generateMetadata = async ({ params }: RefundPageProps): Promise<Metadata> => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  const copy = getDictionary(locale).legal.refund;
  return composePageMetadata({ description: copy.description, locale, path: "/refund", title: copy.title });
};

const RefundPage = async ({ params }: RefundPageProps) => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  const { legal } = getDictionary(locale);

  return (
    <LegalDocument
      lede={legal.refund.lede}
      sections={fillSections(legal.refund.sections, legalValues(locale))}
      title={legal.refund.title}
      tocLabel={legal.toc}
      updated={formatLegalUpdated(locale, legal.updated)}
    />
  );
};

export default RefundPage;
