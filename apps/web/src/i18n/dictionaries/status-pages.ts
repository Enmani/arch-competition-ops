import type { AppLocale } from "../config";
import { status as enStatus } from "./en/status";
import { status as zhStatus } from "./zh/status";

/**
 * Only the framework-state copy (404, error boundary, loading, 403). `error.tsx` and
 * `loading.tsx` are client components that cannot receive the dictionary as props; importing
 * this small module instead of the full dictionary keeps both locales' full text out of the
 * client bundle.
 */
export const statusPages: Record<AppLocale, typeof zhStatus> = { en: enStatus, zh: zhStatus };
