import Image from "next/image";
import Link from "next/link";

import type { StoredOpportunityFeedItem } from "@arch-competition/storage/cloudflare";

import WatchToggleButton from "@/components/watch-toggle-button";
import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { getOpportunityDisplayMeta } from "@/lib/opportunity-display";

type OpportunityStreamItemProps = {
  dictionary: AppDictionary;
  isWatched: boolean;
  locale: AppLocale;
  opportunity: StoredOpportunityFeedItem;
  workspaceWritesEnabled: boolean;
};

const opportunityImageRevision = "20260420g";

export const OpportunityStreamItem = ({
  dictionary,
  isWatched,
  locale,
  opportunity,
  workspaceWritesEnabled,
}: OpportunityStreamItemProps) => {
  const localizedRecordLink = buildLocalePath(locale, `/opportunities/${opportunity.slug}`);
  const imageSrc = `/api/opportunities/${opportunity.slug}/image?rev=${opportunityImageRevision}`;
  const { cardCategoryLabel, cardValueLabel, deadlineValueLabel, locationLabel } =
    getOpportunityDisplayMeta(
    dictionary,
    locale,
    opportunity,
  );

  return (
    <article className="opportunity-tile">
      <Link className="opportunity-tile-link" href={localizedRecordLink}>
        <div className="opportunity-media-frame">
          <div className="opportunity-media">
            <Image
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1200px) 50vw, 22rem"
              src={imageSrc}
              unoptimized
            />
          </div>
          <span
            aria-label={`${dictionary.discover.card.value}: ${cardValueLabel}`}
            className="opportunity-value-chip"
          >
            {cardValueLabel}
          </span>
        </div>

        <div className="opportunity-tile-copy">
          <div className="opportunity-title-box">
            <h2 className="opportunity-tile-title">{opportunity.title}</h2>
            <p className="opportunity-meta-value">{cardCategoryLabel}</p>
          </div>

          <div className="opportunity-meta-strip">
            <div
              aria-label={`${dictionary.discover.card.location}: ${locationLabel}`}
              className="opportunity-meta-box"
            >
              <span className="sr-only">{dictionary.discover.card.location}</span>
              <span className="opportunity-meta-value">{locationLabel}</span>
            </div>
            <div
              aria-label={`${dictionary.discover.card.deadline}: ${deadlineValueLabel}`}
              className="opportunity-meta-box opportunity-meta-box-deadline"
            >
              <span className="sr-only">{dictionary.discover.card.deadline}</span>
              <span className="opportunity-meta-value">{deadlineValueLabel}</span>
            </div>
          </div>
        </div>
      </Link>
      <div className="opportunity-tile-actions">
        <WatchToggleButton
          initialWatched={isWatched}
          opportunityId={opportunity.id}
          workspaceDictionary={dictionary.workspace}
          workspaceWritesEnabled={workspaceWritesEnabled}
        />
      </div>
    </article>
  );
};
