"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during the server render and hydration, true afterwards. For values that depend on the
 * viewer's time zone: rendering them on the server would print the server's zone and then
 * mismatch on hydration.
 */
export const useIsClient = () => useSyncExternalStore(subscribe, () => true, () => false);
