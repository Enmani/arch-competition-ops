import Link from "next/link";

import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

import { OpportunityMedia } from "@/components/opportunity-media";
import WatchToggleButton from "@/components/watch-toggle-button";
import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { DiscoverFeedCopy } from "@/i18n/slices";
import { getOpportunityDisplayMeta } from "@/lib/opportunity-display";

type OpportunityStreamItemProps = {
  copy: DiscoverFeedCopy;
  index: number;
  isWatched: boolean;
  locale: AppLocale;
  onOpen?: (opportunity: StoredOpportunityFeedItem) => void;
  onWatchChange?: (isWatched: boolean) => void;
  opportunity: StoredOpportunityFeedItem;
  signedIn: boolean;
};

export const OpportunityStreamItem = ({
  copy,
  index,
  isWatched,
  locale,
  onOpen,
  onWatchChange,
  opportunity,
  signedIn,
}: OpportunityStreamItemProps) => {
  const localizedRecordLink = buildLocalePath(locale, `/opportunities/${opportunity.slug}`);
  const { cardValueLabel, deadlineValueLabel, displayTitle, locationLineLabel } = getOpportunityDisplayMeta(
    copy,
    locale,
    opportunity,
  );

  return (
    <article className="opportunity-tile" style={{ ["--tile-index" as string]: index }}>
      {/* A plain click opens the side sheet from the data already on screen; the link itself stays for
          new tabs, middle clicks, copying the address and crawlers. */}
      <Link
        className="opportunity-tile-link"
        href={localizedRecordLink}
        onClick={(event) => {
          if (!onOpen || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
          }
          event.preventDefault();
          onOpen(opportunity);
        }}
        prefetch={false}
      >
        <OpportunityMedia slug={opportunity.slug} />

        <div className="opportunity-tile-copy">
          <h2 className="opportunity-tile-title" title={displayTitle === opportunity.title ? undefined : opportunity.title}>
            {displayTitle}
          </h2>
          {/* A caption on a non-interactive element is not announced reliably, so field names are
              spelled out as screen-reader-only text instead of aria-label. A missing value is
              absent, never announced as pending. */}
          <p className="opportunity-tile-meta">
            <span className="opportunity-meta-location">
              <span className="sr-only">{copy.discover.card.location}: </span>
              {locationLineLabel}
            </span>
            {cardValueLabel ? (
              <span className="opportunity-meta-value">
                <span className="sr-only">{copy.discover.card.value}: </span>
                {cardValueLabel}
              </span>
            ) : null}
            <span className="opportunity-meta-deadline">
              <span className="sr-only">{copy.discover.card.deadline}: </span>
              {deadlineValueLabel}
            </span>
          </p>
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
          variant="icon"
        />
      </div>
    </article>
  );
};
