import type { zh } from "./zh";

/**
 * The dictionary shape is derived from the Chinese source of truth. English files use
 * `satisfies AppDictionary[<namespace>]`, so a missing or extra key is a compile error;
 * `dictionaries.test.ts` additionally asserts identical key sets and no blank strings.
 */
export type AppDictionary = typeof zh;
