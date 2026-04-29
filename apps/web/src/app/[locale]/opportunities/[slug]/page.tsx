import { notFound } from "next/navigation";

import {
  getStoredOpportunityFeedItemBySlug,
  isStoredOpportunityWatched,
} from "@arch-competition/storage";

import { OpportunityDetailSurface } from "@/components/opportunity-detail-surface";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
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
  const opportunity = getStoredOpportunityFeedItemBySlug(slug);
  const workspaceKey = resolveWorkspaceKey();
  const workspaceWritesEnabled = isWorkspaceWritesEnabled();

  if (!opportunity) {
    notFound();
  }

  return (
    <OpportunityDetailSurface
      dictionary={dictionary}
      isWatched={isStoredOpportunityWatched({
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
