import { notFound } from "next/navigation";

import { OpportunityDetailSurface } from "@/components/opportunity-detail-surface";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import {
  getWebOpportunityFeedItemBySlug,
  isWebOpportunityWatched,
} from "@/lib/server-storage";
import { isWorkspaceWritesEnabled, resolveWorkspaceKey } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type LocalizedOpportunityDetailPageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

const LocalizedOpportunityDetailPage = async ({
  params,
}: LocalizedOpportunityDetailPageProps) => {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);
  const opportunity = await getWebOpportunityFeedItemBySlug(slug);
  const workspaceKey = resolveWorkspaceKey();
  const workspaceWritesEnabled = isWorkspaceWritesEnabled();

  if (!opportunity) {
    notFound();
  }

  return (
    <OpportunityDetailSurface
      dictionary={dictionary}
      isWatched={await isWebOpportunityWatched({
        opportunityId: opportunity.id,
        workspaceKey,
      })}
      locale={locale}
      opportunity={opportunity}
      workspaceWritesEnabled={workspaceWritesEnabled}
    />
  );
};

export default LocalizedOpportunityDetailPage;
