"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { StatusPanel } from "@/components/status-panel";
import { buildLocalePath, defaultLocale, isLocale } from "@/i18n/config";
import { statusPages } from "@/i18n/dictionaries/status-pages";

type LocaleErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Error boundary for every page under `/[locale]`. It is a client component, so it cannot read
 * the server dictionary; it takes the small status slice for the locale in the URL. The message
 * never includes `error.message` (it may carry internals); only the opaque digest is shown so a
 * report can be matched to the server log.
 */
const LocaleError = ({ error, reset }: LocaleErrorProps) => {
  const { locale: rawLocale } = useParams<{ locale: string }>();
  const locale = isLocale(rawLocale) ? rawLocale : defaultLocale;
  const copy = statusPages[locale].error;

  return (
    <StatusPanel
      actions={
        <>
          <button className="button primary" onClick={reset} type="button">
            {copy.retry}
          </button>
          <Link className="button secondary" href={buildLocalePath(locale, "/discover")}>
            {copy.action}
          </Link>
        </>
      }
      body={copy.body}
      eyebrow={copy.eyebrow}
      role="alert"
      title={copy.title}
    >
      {error.digest ? (
        <span className="status-reference">
          {copy.reference}: {error.digest}
        </span>
      ) : null}
    </StatusPanel>
  );
};

export default LocaleError;
