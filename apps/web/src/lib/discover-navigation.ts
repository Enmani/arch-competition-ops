// A filter change replaces the whole list. If the visitor had scrolled down, the shorter new list
// would leave them below its end, so the new feed brings its top back into view once. The dock
// raises the flag when it navigates; the feed, which remounts for the new filters, consumes it.
// It expires so a navigation that never remounts the feed (same results) cannot trigger a later,
// unrelated mount such as returning with the back button.

const FLAG_LIFETIME_MS = 8000;

let raisedAt: number | null = null;

export const requestFeedTopReset = () => {
  raisedAt = performance.now();
};

export const consumeFeedTopReset = () => {
  const wanted = raisedAt !== null && performance.now() - raisedAt < FLAG_LIFETIME_MS;
  raisedAt = null;
  return wanted;
};
