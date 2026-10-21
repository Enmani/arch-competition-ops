import type { Metadata } from "next";

import { DiscoverSurface } from "@/components/discover-surface";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import type { DiscoverSearchParams } from "@/lib/discover";
import { buildPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

type LocalizedDiscoverPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<DiscoverSearchParams>;
};

export const generateMetadata = async ({ params }: Pick<LocalizedDiscoverPageProps, "params">): Promise<Metadata> =>
  buildPageMetadata(resolveLocaleOrNotFound((await params).locale), "discover", "/discover");

const LocalizedDiscoverPage = async ({
  params,
  searchParams,
}: LocalizedDiscoverPageProps) => {
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);
  const resolvedSearchParams = await searchParams;

  return (
    <DiscoverSurface dictionary={dictionary} locale={locale} searchParams={resolvedSearchParams} />
  );
};

export default LocalizedDiscoverPage;
