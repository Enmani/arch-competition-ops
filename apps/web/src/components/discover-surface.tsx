import Link from "next/link";

import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import {
  countActiveDiscoverFilters,
  discoverRecencyValues,
  discoverSortValues,
  type DiscoverSearchParams,
  readDiscoverFilters,
} from "@/lib/discover";
import {
  getWebDiscoverSurfaceData,
  listWebWatchedOpportunityIds,
} from "@/lib/server-storage";
import { isWorkspaceWritesEnabled, resolveWorkspaceKey } from "@/lib/workspace";
import { DiscoverDock } from "@/components/discover-dock";
import { OpportunityStreamItem } from "@/components/opportunity-stream-item";

type DiscoverSurfaceProps = {
  dictionary: AppDictionary;
  locale: AppLocale;
  searchParams: DiscoverSearchParams;
};

export const DiscoverSurface = async ({
  dictionary,
  locale,
  searchParams,
}: DiscoverSurfaceProps) => {
  const filters = readDiscoverFilters(searchParams);
  const { opportunities, filterOptions } = await getWebDiscoverSurfaceData(filters);
  const activeFilterCount = countActiveDiscoverFilters(filters);
  const routeBase = buildLocalePath(locale, "/discover");
  const workspaceKey = resolveWorkspaceKey();
  const workspaceWritesEnabled = isWorkspaceWritesEnabled();
  const watchedOpportunityIds = new Set(await listWebWatchedOpportunityIds(workspaceKey));
  const sortOptions = [
    { label: dictionary.discover.filterOptions.sortByDeadline, value: "deadline" },
    { label: dictionary.discover.filterOptions.sortByLatest, value: "latest" },
    { label: dictionary.discover.filterOptions.sortByContractValue, value: "highest_value" },
  ] as const;
  const recencyOptions = [
    { label: dictionary.discover.filterOptions.anyCaptureDate, value: "" },
    { label: dictionary.discover.filterOptions.last7Days, value: "7" },
    { label: dictionary.discover.filterOptions.last30Days, value: "30" },
    { label: dictionary.discover.filterOptions.last90Days, value: "90" },
    { label: dictionary.discover.filterOptions.last365Days, value: "365" },
  ] as const;

  return (
    <main className="discover-page">
      <DiscoverDock
        activeFilterCount={activeFilterCount}
        dictionary={dictionary}
        filterOptions={filterOptions}
        filters={filters}
        recencyOptions={recencyOptions}
        routeBase={routeBase}
        sortOptions={sortOptions}
      />

      {opportunities.length > 0 ? (
        <section className="waterfall-feed" aria-label={dictionary.discover.feedRegionLabel}>
          {opportunities.map((opportunity) => (
            <OpportunityStreamItem
              dictionary={dictionary}
              isWatched={watchedOpportunityIds.has(opportunity.id)}
              key={opportunity.id}
              locale={locale}
              opportunity={opportunity}
              workspaceWritesEnabled={workspaceWritesEnabled}
            />
          ))}
        </section>
      ) : (
        <section className="empty-state">
          <span className="eyebrow">{dictionary.discover.empty.eyebrow}</span>
          <h2>{dictionary.discover.empty.title}</h2>
          <p>{dictionary.discover.empty.body}</p>
          <Link className="button primary" href={routeBase}>
            {dictionary.discover.buttons.clearFilters}
          </Link>
        </section>
      )}
    </main>
  );
};
