import { redirect } from "next/navigation";

import { buildLocalePath } from "@/i18n/config";
import { getPreferredLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

type LegacyCompetitionDetailPageProps = {
  params: Promise<{ slug: string }>;
};

const LegacyCompetitionDetailPage = async ({ params }: LegacyCompetitionDetailPageProps) => {
  const { slug } = await params;
  const locale = await getPreferredLocale();
  redirect(buildLocalePath(locale, `/opportunities/${slug}`));
};

export default LegacyCompetitionDetailPage;
