import { DiscoverSurface } from "@/components/discover-surface";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import type { DiscoverSearchParams } from "@/lib/discover";

export const dynamic = "force-dynamic";

type LocalizedDiscoverPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<DiscoverSearchParams>;
};

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
