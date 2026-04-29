import { redirect } from "next/navigation";

import { buildLocalePath } from "@/i18n/config";
import { resolveLocaleOrNotFound } from "@/i18n/server";

export const dynamic = "force-dynamic";

type LocalizedHomePageProps = {
  params: Promise<{ locale: string }>;
};

const LocalizedHomePage = async ({ params }: LocalizedHomePageProps) => {
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  redirect(buildLocalePath(locale, "/discover"));
};

export default LocalizedHomePage;
