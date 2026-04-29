import { redirect } from "next/navigation";

import { buildLocalePath, serializeSearchParams } from "@/i18n/config";
import { getPreferredLocale } from "@/i18n/server";
import type { DiscoverSearchParams } from "@/lib/discover";

export const dynamic = "force-dynamic";

type DiscoverPageProps = {
  searchParams: Promise<DiscoverSearchParams>;
};

const DiscoverPage = async ({ searchParams }: DiscoverPageProps) => {
  const resolvedSearchParams = await searchParams;
  const locale = await getPreferredLocale();
  redirect(buildLocalePath(locale, "/discover") + serializeSearchParams(resolvedSearchParams));
};

export default DiscoverPage;
