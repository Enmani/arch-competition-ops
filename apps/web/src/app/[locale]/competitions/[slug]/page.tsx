import { redirect } from "next/navigation";

import { buildLocalePath } from "@/i18n/config";
import { resolveLocaleOrNotFound } from "@/i18n/server";

export const dynamic = "force-dynamic";

type LocalizedLegacyCompetitionDetailPageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

const LocalizedLegacyCompetitionDetailPage = async ({
  params,
}: LocalizedLegacyCompetitionDetailPageProps) => {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  redirect(buildLocalePath(locale, `/opportunities/${slug}`));
};

export default LocalizedLegacyCompetitionDetailPage;
