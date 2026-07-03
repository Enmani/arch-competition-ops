"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import {
  buildLocalePath,
  localeCookieName,
  stripLocalePrefix,
  type AppLocale,
} from "@/i18n/config";

type LocaleSwitcherProps = {
  activeLocale: AppLocale;
  ariaLabel: string;
  localeAbbreviations: Record<AppLocale, string>;
  localeNames: Record<AppLocale, string>;
};

export const LocaleSwitcher = ({
  activeLocale,
  ariaLabel,
  localeNames,
}: LocaleSwitcherProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const barePathname = stripLocalePrefix(pathname);
  const search = searchParams.toString();
  const targetLocale: AppLocale = activeLocale === "zh" ? "en" : "zh";
  const targetLabel = localeNames[targetLocale];
  const href = buildLocalePath(targetLocale, barePathname);
  const localizedHref = search ? `${href}?${search}` : href;

  const setLocaleCookie = () => {
    document.cookie = `${localeCookieName}=${targetLocale}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <div aria-label={ariaLabel} className="locale-switcher">
      <Link
        aria-label={`${ariaLabel}: ${targetLabel}`}
        className="locale-trigger"
        href={localizedHref}
        onClick={setLocaleCookie}
        title={targetLabel}
      >
        <span aria-hidden="true" className="locale-globe">
          <svg fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.15" />
            <path
              d="M8 2.75C9.52 4.16 10.38 6.04 10.38 8C10.38 9.96 9.52 11.84 8 13.25C6.48 11.84 5.62 9.96 5.62 8C5.62 6.04 6.48 4.16 8 2.75Z"
              stroke="currentColor"
              strokeWidth="1.15"
            />
            <path d="M3 6.3H13" stroke="currentColor" strokeWidth="1.15" />
            <path d="M3 9.7H13" stroke="currentColor" strokeWidth="1.15" />
          </svg>
        </span>
        <span className="locale-trigger-label">{targetLabel}</span>
      </Link>
    </div>
  );
};
