import Link from "next/link";

import { workspaceKeyForUser } from "@arch-competition/storage";

import { DiscoverDock } from "@/components/discover-dock";
import { DiscoverFeed } from "@/components/discover-feed";
import { buildLocalePath, serializeSearchParams, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { pickDiscoverDockCopy, pickDiscoverFeedCopy } from "@/i18n/slices";
import { getCurrentAuthUser } from "@/lib/auth";
import {
  buildDiscoverPageSearchParams,
  countActiveDiscoverFilters,
  readDiscoverPageState,
  type DiscoverSearchParams,
} from "@/lib/discover";
import { getStorage } from "@/lib/server-storage";

type DiscoverSurfaceProps = {
  dictionary: AppDictionary;
  locale: AppLocale;
  searchParams: DiscoverSearchParams;
};

export const DiscoverSurface = async ({ dictionary, locale, searchParams }: DiscoverSurfaceProps) => {
  const { filters, loaded } = readDiscoverPageState(searchParams);
  const storage = await getStorage();
  const user = await getCurrentAuthUser();

  // Restore the visible depth in the same database snapshot as its total and options.
  const [{ continuation, filterOptions, opportunities, total }, watchedOpportunityIds] = await Promise.all([
    storage.opportunities.discover(filters, loaded),
    user ? storage.watchlist.listIds(workspaceKeyForUser(user.id)) : Promise.resolve([] as string[]),
  ]);

  const routeBase = buildLocalePath(locale, "/discover");
  const filtersKey = serializeSearchParams(buildDiscoverPageSearchParams(filters)) || "none";

  return (
    <main className="discover-page">
      <DiscoverDock
        activeFilterCount={countActiveDiscoverFilters(filters)}
        copy={pickDiscoverDockCopy(dictionary)}
        locale={locale}
        filterOptions={filterOptions}
        filters={filters}
        routeBase={routeBase}
        signedIn={user !== null}
      />

      {opportunities.length > 0 ? (
        <DiscoverFeed
          copy={pickDiscoverFeedCopy(dictionary)}
          filters={filters}
          continuation={continuation}
          initialItems={opportunities}
          initialTotal={total}
          initialWatchedIds={watchedOpportunityIds}
          key={`${filtersKey}:${user !== null}`}
          locale={locale}
          routeBase={routeBase}
          signedIn={user !== null}
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
