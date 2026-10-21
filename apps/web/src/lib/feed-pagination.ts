/**
 * Pure state transitions of the discover "load more" feed, kept out of the component so the
 * duplicate and end-of-data handling can be tested without React.
 */
export type FeedState<Item extends { id: string }> = {
  items: Item[];
  /** Offset of the next page. It advances by what the server returned, not by what was kept. */
  nextOffset: number;
  total: number;
};

export type FeedPage<Item> = { opportunities: Item[]; total: number };

export const createFeedState = <Item extends { id: string }>(
  items: Item[],
  total: number,
  nextOffset = items.length,
): FeedState<Item> => ({ items, nextOffset, total });

export const hasMoreItems = (state: FeedState<{ id: string }>) => state.nextOffset < state.total;

/**
 * Appends a fetched page. Items whose id is already present are dropped (the list can shift
 * between requests, and a double request must never produce duplicate React keys). An empty
 * page means the server has fewer rows than it claimed, so it is treated as the end instead of
 * leaving a button that can never make progress.
 */
export const appendFeedPage = <Item extends { id: string }>(
  state: FeedState<Item>,
  page: FeedPage<Item>,
): FeedState<Item> => {
  const seen = new Set(state.items.map((item) => item.id));
  const fresh: Item[] = [];
  for (const item of page.opportunities) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      fresh.push(item);
    }
  }

  if (page.opportunities.length === 0) {
    return { items: state.items, nextOffset: state.nextOffset, total: state.nextOffset };
  }

  return {
    items: fresh.length > 0 ? [...state.items, ...fresh] : state.items,
    nextOffset: state.nextOffset + page.opportunities.length,
    total: page.total,
  };
};
