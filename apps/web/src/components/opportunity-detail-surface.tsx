import Link from "next/link";

import type { OpportunityWithPreview } from "@/lib/opportunity-preview-assets";

import { OpportunityDetailBody } from "@/components/opportunity-detail-body";
import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { DiscoverFeedCopy } from "@/i18n/slices";

type OpportunityDetailSurfaceProps = {
  copy: DiscoverFeedCopy;
  isWatched: boolean;
  locale: AppLocale;
  opportunity: OpportunityWithPreview;
  signedIn: boolean;
};

/** The standalone page (direct visit, shared link, search result): the same body with a way back. */
export const OpportunityDetailSurface = ({
  copy,
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
      {copy.detail.drawer.back}
    </Link>
    <OpportunityDetailBody
      copy={copy}
      isWatched={isWatched}
      locale={locale}
      now={new Date()}
      opportunity={opportunity}
      signedIn={signedIn}
    />
  </main>
);
