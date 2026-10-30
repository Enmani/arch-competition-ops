import Link from "next/link";
import Image from "next/image";

import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

import WatchToggleButton from "@/components/watch-toggle-button";
import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { DiscoverFeedCopy } from "@/i18n/slices";
import { getOpportunityDisplayMeta } from "@/lib/opportunity-display";
import { opportunityImageRevision } from "@/lib/opportunity-preview-revision";

type OpportunityStreamItemProps = {
  copy: DiscoverFeedCopy;
  index: number;
  isWatched: boolean;
  locale: AppLocale;
  onWatchChange?: (isWatched: boolean) => void;
  opportunity: StoredOpportunityFeedItem;
  signedIn: boolean;
};

export const OpportunityStreamItem = ({
  copy,
  index,
  isWatched,
  locale,
  onWatchChange,
  opportunity,
  signedIn,
}: OpportunityStreamItemProps) => {
  const localizedRecordLink = buildLocalePath(locale, `/opportunities/${opportunity.slug}`);
  const imageSrc = `/api/opportunities/${opportunity.slug}/image?rev=${opportunityImageRevision}`;
  const { cardCategoryLabel, cardValueLabel, deadlineValueLabel, locationLabel } = getOpportunityDisplayMeta(
    copy,
    locale,
    opportunity,
  );

  return (
    <article className="opportunity-tile" style={{ ["--tile-index" as string]: index }}>
      <Link className="opportunity-tile-link" href={localizedRecordLink}>
        <div className="opportunity-media">
          <Image
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1200px) 50vw, 22rem"
            src={imageSrc}
            unoptimized
          />
          {/* A name on a non-interactive element is not announced reliably, so field names are
              spelled out as screen-reader-only text instead of aria-label. */}
          {cardValueLabel ? (
            <span className="opportunity-value-chip">
              <span className="sr-only">{copy.discover.card.value}: </span>
              {cardValueLabel}
            </span>
          ) : null}
        </div>

        <div className="opportunity-tile-copy">
          <h2 className="opportunity-tile-title">{opportunity.title}</h2>
          <p className="opportunity-tile-category">{cardCategoryLabel}</p>
          <div className="opportunity-meta-strip">
            <span className="opportunity-meta-value">
              <span className="sr-only">{copy.discover.card.location}: </span>
              {locationLabel}
            </span>
            <span className="opportunity-meta-value opportunity-meta-deadline">
              <span className="sr-only">{copy.discover.card.deadline}: </span>
              {deadlineValueLabel}
            </span>
          </div>
        </div>
      </Link>
      <div className="opportunity-tile-actions">
        <WatchToggleButton
          copy={copy}
          initialWatched={isWatched}
          locale={locale}
          onToggle={onWatchChange}
          opportunityId={opportunity.id}
          signedIn={signedIn}
        />
      </div>
    </article>
  );
};
