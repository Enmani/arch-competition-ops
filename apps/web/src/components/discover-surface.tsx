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
import { DiscoverFeed } from "@/components/discover-feed";
import { DiscoverDock } from "@/components/discover-dock";

const DISCOVER_INITIAL_BATCH = 36;

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
  const { opportunities, filterOptions, total } = await getWebDiscoverSurfaceData({
    ...filters,
    limit: DISCOVER_INITIAL_BATCH,
    offset: 0,
  });
  const activeFilterCount = countActiveDiscoverFilters(filters);
  const routeBase = buildLocalePath(locale, "/discover");
  const workspaceKey = resolveWorkspaceKey();
  const workspaceWritesEnabled = isWorkspaceWritesEnabled();
  const watchedOpportunityIds = await listWebWatchedOpportunityIds(workspaceKey);
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
        <DiscoverFeed
          dictionary={dictionary}
          filters={filters}
          initialItems={opportunities}
          initialWatchedIds={watchedOpportunityIds}
          locale={locale}
          routeBase={routeBase}
          total={total}
          workspaceWritesEnabled={workspaceWritesEnabled}
        />
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
