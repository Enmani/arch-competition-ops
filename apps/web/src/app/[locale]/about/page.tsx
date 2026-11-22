import type { Metadata } from "next";

import { AboutCookies } from "@/components/about-cookies";
import { LegalLinkList } from "@/components/legal-extras";
import { LegalDocument } from "@/components/legal-document";
import { SupportLinkList } from "@/components/support-link-list";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { fillSections, legalValues } from "@/lib/legal-content";
import { composePageMetadata } from "@/lib/page-metadata";

type AboutPageProps = { params: Promise<{ locale: string }> };

export const generateMetadata = async ({ params }: AboutPageProps): Promise<Metadata> => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  const copy = getDictionary(locale).about;
  return composePageMetadata({ description: copy.description, locale, path: "/about", title: copy.title });
};

const AboutPage = async ({ params }: AboutPageProps) => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  const { about, legal } = getDictionary(locale);
  const extras: Record<string, React.ReactNode> = {
    contact: <SupportLinkList locale={locale} />,
    cookies: <AboutCookies copy={about.cookies} />,
    legal: (
      <LegalLinkList
        labels={{ privacy: legal.privacy.title, refund: legal.refund.title, terms: legal.terms.title }}
        locale={locale}
      />
    ),
  };
  const sections = fillSections(about.sections, legalValues(locale)).map((section) => ({
    ...section,
    extra: extras[section.id],
  }));

  return <LegalDocument lede={about.lede} sections={sections} title={about.title} tocLabel={legal.toc} />;
};

export default AboutPage;
