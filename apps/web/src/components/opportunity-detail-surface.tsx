import Link from "next/link";

import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

import { OpportunityDetailBody } from "@/components/opportunity-detail-body";
import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";

type OpportunityDetailSurfaceProps = {
  dictionary: AppDictionary;
  isWatched: boolean;
  locale: AppLocale;
  opportunity: StoredOpportunityFeedItem;
  signedIn: boolean;
};

/** The standalone page (direct visit, shared link, search result): the same body with a way back. */
export const OpportunityDetailSurface = ({
  dictionary,
  isWatched,
  locale,
  opportunity,
  signedIn,
}: OpportunityDetailSurfaceProps) => (
  <main className="detail-page">
    <Link className="detail-back" href={buildLocalePath(locale, "/discover")}>
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
        <path d="M10 3L5 8l5 5" />
      </svg>
      {dictionary.detail.drawer.back}
    </Link>
    <OpportunityDetailBody
      dictionary={dictionary}
      isWatched={isWatched}
      locale={locale}
      now={new Date()}
      opportunity={opportunity}
      signedIn={signedIn}
    />
  </main>
);
