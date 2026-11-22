import type { Metadata } from "next";

import { MCP_MAX_ACTIVE_KEYS } from "@arch-competition/core";
import { workspaceKeyForUser } from "@arch-competition/storage";

import { McpAccountPanel } from "@/components/mcp-account-panel";

import { SavedSearchesPanel } from "@/components/saved-searches-panel";
import WatchlistDashboardTable, { type WatchlistDashboardRow } from "@/components/watchlist-dashboard-table";
import { buildLocalePath } from "@/i18n/config";
import { pickDashboardTableCopy, pickMcpAccountCopy, pickSavedSearchCopy } from "@/i18n/slices";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { requirePageUser } from "@/lib/auth";
import { readBillingReturn } from "@/lib/mcp-account";
import { buildPageMetadata } from "@/lib/page-metadata";
import { getStorage } from "@/lib/server-storage";

export const dynamic = "force-dynamic";

type LocalizedDashboardPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const generateMetadata = async ({ params }: Pick<LocalizedDashboardPageProps, "params">): Promise<Metadata> => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  // Private page: titled for the tab, but kept out of search indexes.
  return buildPageMetadata(locale, "dashboard", "/dashboard", { index: false });
};

const LocalizedDashboardPage = async ({ params, searchParams }: LocalizedDashboardPageProps) => {
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);
  // The workspace is private: anonymous visitors are sent to sign in and come back here.
  const user = await requirePageUser(locale, buildLocalePath(locale, "/dashboard"));
  const storage = await getStorage();
  const workspaceKey = workspaceKeyForUser(user.id);
  const billing = (await searchParams).billing;
  const [watchlistEntries, savedSearches, mcpKeys, mcpUsage] = await Promise.all([
    storage.watchlist.list({ limit: 24, workspaceKey }),
    storage.savedSearches.list({ limit: 20, workspaceKey }),
    storage.mcp.listKeys(user.id),
    storage.mcp.getUsage(user.id),
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
    <main className="dashboard-page">
      <header className="dashboard-header">
        <span className="eyebrow">{dictionary.dashboard.eyebrow}</span>
        <h1>{dictionary.dashboard.title}</h1>
      </header>

      <McpAccountPanel
        billingReturn={readBillingReturn(typeof billing === "string" ? billing : null)}
        connectHref={buildLocalePath(locale, "/connect")}
        copy={pickMcpAccountCopy(dictionary)}
        initialKeys={mcpKeys}
        initialUsage={mcpUsage}
        locale={locale}
        maxActiveKeys={MCP_MAX_ACTIVE_KEYS}
      />

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{dictionary.dashboard.watchlistTitle}</h2>
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
      </div>
    </main>
  );
};

export default LocalizedDashboardPage;
