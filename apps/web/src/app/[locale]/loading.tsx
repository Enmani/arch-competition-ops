"use client";

import { useParams } from "next/navigation";

import { defaultLocale, isLocale } from "@/i18n/config";
import { statusPages } from "@/i18n/dictionaries/status-pages";

/** Route-level fallback while a page streams in; announced once to assistive technology. */
const LocaleLoading = () => {
  const { locale: rawLocale } = useParams<{ locale: string }>();
  const label = statusPages[isLocale(rawLocale) ? rawLocale : defaultLocale].loading.label;

  return (
    <div aria-busy="true" className="loading-skeleton" role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="loading-bar" />
      <div aria-hidden="true" className="loading-bar" />
      <div aria-hidden="true" className="loading-bar" />
    </div>
  );
};

export default LocaleLoading;
