import type { AppLocale } from "../config";
import { en } from "./en";
import type { AppDictionary } from "./types";
import { zh } from "./zh";

export type { AppDictionary } from "./types";

export const dictionaries: Record<AppLocale, AppDictionary> = { en, zh };
