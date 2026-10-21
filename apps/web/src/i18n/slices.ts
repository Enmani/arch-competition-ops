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

export type DiscoverFeedCopy = DisplayCopy &
  WatchToggleCopy & {
    discover: Pick<Dictionary["discover"], "buttons" | "card" | "feed" | "feedRegionLabel">;
  };

export const pickDiscoverFeedCopy = (dictionary: Dictionary): DiscoverFeedCopy => ({
  common: dictionary.common,
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
