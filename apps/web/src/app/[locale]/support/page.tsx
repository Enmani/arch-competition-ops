import { SupportSurface } from "@/components/support-surface";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";

export const dynamic = "force-dynamic";

type LocalizedSupportPageProps = {
  params: Promise<{ locale: string }>;
};

const LocalizedSupportPage = async ({ params }: LocalizedSupportPageProps) => {
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);

  return <SupportSurface dictionary={dictionary} locale={locale} />;
};

export default LocalizedSupportPage;
