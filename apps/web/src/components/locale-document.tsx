"use client";

import { useEffect } from "react";

import { localeCookieName, type AppLocale } from "@/i18n/config";

type LocaleDocumentProps = {
  locale: AppLocale;
};

export const LocaleDocument = ({ locale }: LocaleDocumentProps) => {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.cookie = `${localeCookieName}=${locale}; path=/; max-age=31536000; samesite=lax`;
  }, [locale]);

  return null;
};
