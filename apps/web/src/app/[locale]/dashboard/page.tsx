import {
  getStoredOpportunityFeedItemBySlug,
  queryStoredWatchlistEntries,
} from "@arch-competition/storage";

import WatchlistDashboardTable, {
  type WatchlistDashboardRow,
} from "@/components/watchlist-dashboard-table";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { isWorkspaceWritesEnabled, resolveWorkspaceKey } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type LocalizedDashboardPageProps = {
  params: Promise<{ locale: string }>;
};

const LocalizedDashboardPage = async ({ params }: LocalizedDashboardPageProps) => {
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);
  const workspaceKey = resolveWorkspaceKey();
  const workspaceWritesEnabled = isWorkspaceWritesEnabled();
  const opportunities = queryStoredWatchlistEntries({ limit: 24, workspaceKey })
    .map((entry) => {
      const opportunity = getStoredOpportunityFeedItemBySlug(entry.opportunityId);
      if (!opportunity) {
        return null;
      }

      return {
        opportunity,
        watchedAt: entry.updatedAt,
      } satisfies WatchlistDashboardRow;
    })
    .filter((item): item is WatchlistDashboardRow => item !== null);

  return (
    <main className="content-grid" style={{ paddingTop: 28 }}>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">{dictionary.dashboard.eyebrow}</span>
            <h2>{dictionary.dashboard.title}</h2>
            <p>{dictionary.dashboard.description}</p>
          </div>
        </div>
        <WatchlistDashboardTable
          dictionary={dictionary}
          initialRows={opportunities}
          locale={locale}
          workspaceWritesEnabled={workspaceWritesEnabled}
        />
      </section>

      <aside className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">{dictionary.dashboard.roadmap.eyebrow}</span>
            <h2>{dictionary.dashboard.roadmap.title}</h2>
          </div>
        </div>
        <div className="card-grid">
          {dictionary.dashboard.roadmap.items.map((item) => (
            <article key={item} className="competition-card">
              <p>{item}</p>
            </article>
          ))}
        </div>
      </aside>
    </main>
  );
};

export default LocalizedDashboardPage;
