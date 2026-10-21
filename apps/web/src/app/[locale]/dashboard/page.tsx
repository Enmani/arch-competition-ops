import type { Metadata } from "next";

import { workspaceKeyForUser } from "@arch-competition/storage";

import { SavedSearchesPanel } from "@/components/saved-searches-panel";
import WatchlistDashboardTable, { type WatchlistDashboardRow } from "@/components/watchlist-dashboard-table";
import { buildLocalePath } from "@/i18n/config";
import { pickDashboardTableCopy, pickSavedSearchCopy } from "@/i18n/slices";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { requirePageUser } from "@/lib/auth";
import { buildPageMetadata } from "@/lib/page-metadata";
import { getStorage } from "@/lib/server-storage";

export const dynamic = "force-dynamic";

type LocalizedDashboardPageProps = {
  params: Promise<{ locale: string }>;
};

export const generateMetadata = async ({ params }: LocalizedDashboardPageProps): Promise<Metadata> => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  // Private page: titled for the tab, but kept out of search indexes.
  return buildPageMetadata(locale, "dashboard", "/dashboard", { index: false });
};

const LocalizedDashboardPage = async ({ params }: LocalizedDashboardPageProps) => {
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);
  // The workspace is private: anonymous visitors are sent to sign in and come back here.
  const user = await requirePageUser(locale, buildLocalePath(locale, "/dashboard"));
  const storage = await getStorage();
  const workspaceKey = workspaceKeyForUser(user.id);
  const [watchlistEntries, savedSearches] = await Promise.all([
    storage.watchlist.list({ limit: 24, workspaceKey }),
    storage.savedSearches.list({ limit: 20, workspaceKey }),
  ]);
  // One IN query for all entries instead of one query per entry.
  const watchedOpportunities = await storage.opportunities.getByIds(
    watchlistEntries.map((entry) => entry.opportunityId),
  );
  const opportunitiesById = new Map(watchedOpportunities.map((opportunity) => [opportunity.id, opportunity]));
  const rows = watchlistEntries.flatMap((entry): WatchlistDashboardRow[] => {
    const opportunity = opportunitiesById.get(entry.opportunityId);
    return opportunity ? [{ opportunity, watchedAt: entry.updatedAt }] : [];
  });

  return (
    <main className="content-grid" style={{ paddingTop: 28 }}>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">{dictionary.dashboard.eyebrow}</span>
            <h1>{dictionary.dashboard.title}</h1>
            <p>{dictionary.dashboard.description}</p>
          </div>
        </div>
        <WatchlistDashboardTable copy={pickDashboardTableCopy(dictionary)} initialRows={rows} locale={locale} />
      </section>

      <aside className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">{dictionary.workspace.savedSearches.eyebrow}</span>
            <h2>{dictionary.workspace.savedSearches.title}</h2>
            <p>{dictionary.workspace.savedSearches.description}</p>
          </div>
        </div>
        <SavedSearchesPanel
          copy={pickSavedSearchCopy(dictionary)}
          initialItems={savedSearches}
          locale={locale}
        />
      </aside>
    </main>
  );
};

export default LocalizedDashboardPage;
