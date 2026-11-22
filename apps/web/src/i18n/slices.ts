import type { AppDictionary } from "./dictionaries";

/**
 * Dictionary slices for client components. A client component's props are serialized into the
 * page payload, so each one gets only the namespaces it reads instead of the whole dictionary.
 * The types are derived from the dictionary, so a renamed key breaks the build here.
 */
type Dictionary = AppDictionary;

/** What `getOpportunityDisplayMeta` and the label formatters read. */
export type DisplayCopy = Pick<Dictionary, "common" | "taxonomy">;

export type WatchToggleCopy = {
  common: Pick<Dictionary["common"], "apiErrors" | "signIn">;
  workspace: Pick<Dictionary["workspace"], "watchlist">;
};

export const pickWatchToggleCopy = (dictionary: Dictionary): WatchToggleCopy => ({
  common: { apiErrors: dictionary.common.apiErrors, signIn: dictionary.common.signIn },
  workspace: { watchlist: dictionary.workspace.watchlist },
});

/** Everything the list and the side sheet opened from it read. */
export type DiscoverFeedCopy = DisplayCopy &
  WatchToggleCopy & {
    detail: Dictionary["detail"];
    discover: Pick<Dictionary["discover"], "buttons" | "card" | "feed" | "feedRegionLabel">;
  };

export const pickDiscoverFeedCopy = (dictionary: Dictionary): DiscoverFeedCopy => ({
  common: dictionary.common,
  detail: dictionary.detail,
  discover: {
    buttons: dictionary.discover.buttons,
    card: dictionary.discover.card,
    feed: dictionary.discover.feed,
    feedRegionLabel: dictionary.discover.feedRegionLabel,
  },
  taxonomy: dictionary.taxonomy,
  workspace: { watchlist: dictionary.workspace.watchlist },
});

export type SavedSearchCopy = {
  apiErrors: Dictionary["common"]["apiErrors"];
  savedSearches: Dictionary["workspace"]["savedSearches"];
  signIn: Dictionary["common"]["signIn"];
};

export const pickSavedSearchCopy = (dictionary: Dictionary): SavedSearchCopy => ({
  apiErrors: dictionary.common.apiErrors,
  savedSearches: dictionary.workspace.savedSearches,
  signIn: dictionary.common.signIn,
});

export type DiscoverDockCopy = {
  discover: Dictionary["discover"];
  saved: SavedSearchCopy;
  taxonomy: Pick<
    Dictionary["taxonomy"],
    | "buildingCategories"
    | "designScopes"
    | "implementationPaths"
    | "jurisdictions"
    | "procedures"
    | "projectModes"
    | "projectTypes"
  >;
};

export const pickDiscoverDockCopy = (dictionary: Dictionary): DiscoverDockCopy => ({
  discover: dictionary.discover,
  saved: pickSavedSearchCopy(dictionary),
  taxonomy: {
    buildingCategories: dictionary.taxonomy.buildingCategories,
    designScopes: dictionary.taxonomy.designScopes,
    implementationPaths: dictionary.taxonomy.implementationPaths,
    jurisdictions: dictionary.taxonomy.jurisdictions,
    procedures: dictionary.taxonomy.procedures,
    projectModes: dictionary.taxonomy.projectModes,
    projectTypes: dictionary.taxonomy.projectTypes,
  },
});

export type DashboardTableCopy = DisplayCopy &
  WatchToggleCopy & {
    dashboard: Pick<Dictionary["dashboard"], "eyebrow" | "empty" | "table">;
  };

export const pickDashboardTableCopy = (dictionary: Dictionary): DashboardTableCopy => ({
  common: dictionary.common,
  dashboard: {
    eyebrow: dictionary.dashboard.eyebrow,
    empty: dictionary.dashboard.empty,
    table: dictionary.dashboard.table,
  },
  taxonomy: dictionary.taxonomy,
  workspace: { watchlist: dictionary.workspace.watchlist },
});

/** The connect page: address, client tabs, inline key creation and the new-key dialog. */
export type ConnectCopy = Pick<Dictionary["mcp"], "connect" | "copy" | "quota"> & {
  created: Dictionary["mcp"]["account"]["created"];
  errors: Dictionary["mcp"]["account"]["errors"];
  actions: Dictionary["mcp"]["account"]["actions"];
  defaultKeyName: string;
  closeLabel: string;
};

export const pickConnectCopy = (dictionary: Dictionary): ConnectCopy => ({
  actions: dictionary.mcp.account.actions,
  closeLabel: dictionary.shell.closeLabel,
  connect: dictionary.mcp.connect,
  copy: dictionary.mcp.copy,
  created: dictionary.mcp.account.created,
  defaultKeyName: dictionary.mcp.account.keys.defaultName,
  errors: dictionary.mcp.account.errors,
  quota: dictionary.mcp.quota,
});

/** The account sections on the dashboard: keys, usage and plan. */
export type McpAccountCopy = Pick<Dictionary["mcp"], "account" | "copy" | "plans" | "quota"> & { closeLabel: string };

export const pickMcpAccountCopy = (dictionary: Dictionary): McpAccountCopy => ({
  account: dictionary.mcp.account,
  closeLabel: dictionary.shell.closeLabel,
  copy: dictionary.mcp.copy,
  plans: dictionary.mcp.plans,
  quota: dictionary.mcp.quota,
});
