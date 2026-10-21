import type { Metadata } from "next";
import { SupportSurface } from "@/components/support-surface";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { buildPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

type LocalizedSupportPageProps = {
  params: Promise<{ locale: string }>;
};

export const generateMetadata = async ({ params }: Pick<LocalizedSupportPageProps, "params">): Promise<Metadata> =>
  buildPageMetadata(resolveLocaleOrNotFound((await params).locale), "support", "/support");

const LocalizedSupportPage = async ({ params }: LocalizedSupportPageProps) => {
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);

  return <SupportSurface dictionary={dictionary} locale={locale} />;
};

export default LocalizedSupportPage;
