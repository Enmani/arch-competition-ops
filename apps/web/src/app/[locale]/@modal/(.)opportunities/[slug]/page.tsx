import { notFound } from "next/navigation";

import { workspaceKeyForUser } from "@arch-competition/storage";

import { OpportunityDetailBody } from "@/components/opportunity-detail-body";
import { OpportunityDrawer } from "@/components/opportunity-drawer";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { getCurrentAuthUser } from "@/lib/auth";
import { getStorage } from "@/lib/server-storage";

export const dynamic = "force-dynamic";

type DrawerPageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

/** Same record and same body as the standalone page, shown as a side sheet over the list. */
const OpportunityDrawerPage = async ({ params }: DrawerPageProps) => {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const storage = await getStorage();
  const opportunity = await storage.opportunities.getBySlug(slug);
  if (!opportunity) {
    notFound();
  }

  const dictionary = getDictionary(locale);
  const user = await getCurrentAuthUser();
  const isWatched = user
    ? await storage.watchlist.isWatched({ opportunityId: opportunity.id, workspaceKey: workspaceKeyForUser(user.id) })
    : false;

  return (
    <OpportunityDrawer closeLabel={dictionary.detail.drawer.close} label={dictionary.detail.drawer.label}>
      <OpportunityDetailBody
        dictionary={dictionary}
        isWatched={isWatched}
        locale={locale}
        now={new Date()}
        opportunity={opportunity}
        signedIn={user !== null}
      />
    </OpportunityDrawer>
  );
};

export default OpportunityDrawerPage;
