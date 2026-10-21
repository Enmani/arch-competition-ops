import type { AppDictionary } from "../types";

export const workspace = {
  savedSearches: {
    eyebrow: "Saved screens",
    title: "Save current screen",
    description: "Persist the current discover screen as a reusable entry point.",
    nameLabel: "Saved-search name",
    placeholder: "For example: Italy high-value education work",
    save: "Save current screen",
    saving: "Saving",
    remove: "Remove",
    empty: "No saved searches yet.",
    open: "Open",
    saved: "Saved.",
    listLabel: "Saved searches",
    errors: {
      save: "Failed to save the search.",
      remove: "Failed to remove the search.",
    },
  },
  watchlist: {
    watch: "Watch",
    unwatch: "Unwatch",
    saving: "Saving",
    watched: "Watched",
    signInToWatch: "Sign in to watch",
    errors: {
      update: "Failed to update the watchlist.",
    },
  },
} satisfies AppDictionary["workspace"];
