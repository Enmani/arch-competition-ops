import { type ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SiteShell } from "@/components/site-shell";
import { locales } from "@/i18n/config";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { getCurrentAuthUser, isAdminEmail } from "@/lib/auth";

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
      <SiteShell
        authCopy={dictionary.auth}
        authUserEmail={authUser?.email ?? null}
        consentCopy={dictionary.legal.consent}
        copy={dictionary.shell}
        footer={<SiteFooter copy={dictionary.legal} locale={locale} year={new Date().getUTCFullYear()} />}
        locale={locale}
        showOpsLink={authUser !== null && isAdminEmail(authUser.email)}
      >
        {children}
      </SiteShell>
    </>
  );
};

export default LocaleLayout;
