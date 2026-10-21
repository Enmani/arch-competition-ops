import assert from "node:assert/strict";
import test from "node:test";

import { appendFeedPage, createFeedState, hasMoreItems } from "./feed-pagination";

const item = (id: string) => ({ id });
const ids = (state: { items: Array<{ id: string }> }) => state.items.map((entry) => entry.id);

test("appending a page keeps order and advances the offset by what the server returned", () => {
  const next = appendFeedPage(createFeedState([item("a"), item("b")], 6), {
    opportunities: [item("c"), item("d")],
    total: 6,
  });
  assert.deepEqual(ids(next), ["a", "b", "c", "d"]);
  assert.equal(next.nextOffset, 4);
  assert.equal(hasMoreItems(next), true);
});

test("ids already on screen are dropped, but the offset still advances so paging cannot stall", () => {
  const next = appendFeedPage(createFeedState([item("a"), item("b")], 4), {
    opportunities: [item("b"), item("c")],
    total: 4,
  });
  assert.deepEqual(ids(next), ["a", "b", "c"]);
  assert.equal(next.nextOffset, 4);
  assert.equal(hasMoreItems(next), false);
});

test("duplicates inside one page are collapsed", () => {
  const next = appendFeedPage(createFeedState([item("a")], 5), {
    opportunities: [item("b"), item("b"), item("c")],
    total: 5,
  });
  assert.deepEqual(ids(next), ["a", "b", "c"]);
});

test("an empty page ends the feed even when the total claimed more rows", () => {
  const state = createFeedState([item("a"), item("b")], 10);
  const next = appendFeedPage(state, { opportunities: [], total: 10 });
  assert.equal(hasMoreItems(next), false);
  assert.equal(next.items, state.items);
});

test("the total is refreshed from the latest page", () => {
  const next = appendFeedPage(createFeedState([item("a")], 5), { opportunities: [item("b")], total: 3 });
  assert.equal(next.total, 3);
  assert.equal(hasMoreItems(next), true);
});

test("a second fetch of the same page does not duplicate items (double-click safety)", () => {
  const page = { opportunities: [item("b"), item("c")], total: 9 };
  const once = appendFeedPage(createFeedState([item("a")], 9), page);
  const twice = appendFeedPage(once, page);
  assert.deepEqual(ids(twice), ["a", "b", "c"]);
});
