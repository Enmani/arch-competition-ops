import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { workspaceKeyForUser } from "@arch-competition/storage";

import { OpportunityDetailSurface } from "@/components/opportunity-detail-surface";
import { fillTemplate } from "@/i18n/format";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { getCurrentAuthUser } from "@/lib/auth";
import { getOpportunityDisplayMeta } from "@/lib/opportunity-display";
import { opportunityImageRevision } from "@/lib/opportunity-preview-revision";
import { composePageMetadata } from "@/lib/page-metadata";
import { getStorage } from "@/lib/server-storage";

export const dynamic = "force-dynamic";

type LocalizedOpportunityDetailPageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

// generateMetadata and the page both need the record; React's cache makes it one query.
const loadOpportunity = cache(async (slug: string) => (await getStorage()).opportunities.getBySlug(slug));

export const generateMetadata = async ({ params }: LocalizedOpportunityDetailPageProps): Promise<Metadata> => {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);
  const opportunity = await loadOpportunity(slug);

  if (!opportunity) {
    return { robots: { follow: false, index: false }, title: dictionary.meta.detailFallbackTitle };
  }

  const { authorityLabel, deadlineLabel, locationLabel } = getOpportunityDisplayMeta(dictionary, locale, opportunity);
  const facts = [opportunity.authorityName.trim() ? authorityLabel : null, locationLabel, deadlineLabel]
    .filter(Boolean)
    .join(" · ");

  return composePageMetadata({
    description: fillTemplate(dictionary.meta.detailDescription, { facts }),
    images: [`/api/opportunities/${opportunity.slug}/image?rev=${opportunityImageRevision}`],
    locale,
    path: `/opportunities/${encodeURIComponent(opportunity.slug)}`,
    title: opportunity.title,
    type: "article",
  });
};

const LocalizedOpportunityDetailPage = async ({ params }: LocalizedOpportunityDetailPageProps) => {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const opportunity = await loadOpportunity(slug);
  if (!opportunity) {
    notFound();
  }

  const user = await getCurrentAuthUser();
  const isWatched = user
    ? await (
        await getStorage()
      ).watchlist.isWatched({ opportunityId: opportunity.id, workspaceKey: workspaceKeyForUser(user.id) })
    : false;

  return (
    <OpportunityDetailSurface
      dictionary={getDictionary(locale)}
      isWatched={isWatched}
      locale={locale}
      opportunity={opportunity}
      signedIn={user !== null}
    />
  );
};

export default LocalizedOpportunityDetailPage;
