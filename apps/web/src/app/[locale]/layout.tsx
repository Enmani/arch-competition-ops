import { type ReactNode } from "react";

import { LocaleDocument } from "@/components/locale-document";
import { SiteShell } from "@/components/site-shell";
import { locales } from "@/i18n/config";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { getCurrentAuthUser } from "@/lib/auth";

type LocaleLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export const generateStaticParams = () => locales.map((locale) => ({ locale }));

const LocaleLayout = async ({ children, params }: LocaleLayoutProps) => {
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);
  const authUser = await getCurrentAuthUser();

  return (
    <>
      <LocaleDocument locale={locale} />
      <SiteShell authUserEmail={authUser?.email ?? null} copy={dictionary.shell} locale={locale}>
        {children}
      </SiteShell>
    </>
  );
};

export default LocaleLayout;
