import { redirect } from "next/navigation";

import { buildLocalePath } from "@/i18n/config";
import { getPreferredLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

type OpportunityDetailPageProps = {
  params: Promise<{ slug: string }>;
};

const OpportunityDetailPage = async ({ params }: OpportunityDetailPageProps) => {
  const { slug } = await params;
  const locale = await getPreferredLocale();
  redirect(buildLocalePath(locale, `/opportunities/${slug}`));
};

export default OpportunityDetailPage;
