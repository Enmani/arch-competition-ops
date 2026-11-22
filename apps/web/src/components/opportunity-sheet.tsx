"use client";

import { useEffect, useState } from "react";

import type { OpportunityWithPreview } from "@/lib/opportunity-preview-assets";

import { OpportunityDetailBody } from "@/components/opportunity-detail-body";
import { OpportunityDrawer } from "@/components/opportunity-drawer";
import type { AppLocale } from "@/i18n/config";
import type { DiscoverFeedCopy } from "@/i18n/slices";
import { loadOpportunityDetail } from "@/lib/opportunity-detail-client";

type OpportunitySheetProps = {
  copy: DiscoverFeedCopy;
  isWatched: boolean;
  locale: AppLocale;
  onClose: () => void;
  onWatchChange: (isWatched: boolean) => void;
  opportunity: OpportunityWithPreview;
  signedIn: boolean;
};

/**
 * Opens at once from the list item already on screen. The AI overview and the notice excerpts
 * come from the detail request on open and replace the
 * placeholder without reloading the sheet. The list mounts one sheet per opened item.
 */
export const OpportunitySheet = ({
  copy,
  isWatched,
  locale,
  onClose,
  onWatchChange,
  opportunity,
  signedIn,
}: OpportunitySheetProps) => {
  const [now] = useState(() => new Date());
  const [detail, setDetail] = useState<OpportunityWithPreview | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let current = true;
    void loadOpportunityDetail(opportunity.slug).then((loaded) => {
      if (current) {
        setDetail(loaded);
        setSettled(true);
      }
    });
    return () => {
      current = false;
    };
  }, [opportunity.slug]);

  return (
    <OpportunityDrawer closeLabel={copy.detail.drawer.close} label={copy.detail.drawer.label} onClose={onClose}>
      <OpportunityDetailBody
        copy={copy}
        isWatched={isWatched}
        locale={locale}
        now={now}
        onWatchChange={onWatchChange}
        opportunity={detail ?? opportunity}
        pending={!settled}
        signedIn={signedIn}
      />
    </OpportunityDrawer>
  );
};
