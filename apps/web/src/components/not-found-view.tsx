import Link from "next/link";

import { StatusPanel } from "@/components/status-panel";
import { buildLocalePath } from "@/i18n/config";
import { getDictionary, getRequestLocale } from "@/i18n/server";

/** Shared by the root 404 (unmatched URL, no site shell) and the locale 404 (`notFound()`). */
export const NotFoundView = async () => {
  const locale = await getRequestLocale();
  const copy = getDictionary(locale).status.notFound;

  return (
    <StatusPanel
      actions={
        <Link className="button primary" href={buildLocalePath(locale, "/discover")}>
          {copy.action}
        </Link>
      }
      body={copy.body}
      eyebrow={copy.eyebrow}
      title={copy.title}
    />
  );
};
