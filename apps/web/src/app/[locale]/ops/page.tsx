import type { Metadata } from "next";
import Link from "next/link";

import OpsReviewQueue from "@/components/ops-review-queue";
import OpsSourceHealthTable from "@/components/ops-source-health-table";
import { StatusPanel } from "@/components/status-panel";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { buildLocalePath } from "@/i18n/config";
import { isAdminEmail, requirePageUser } from "@/lib/auth";
import { buildPageMetadata } from "@/lib/page-metadata";
import { getStorage } from "@/lib/server-storage";

export const dynamic = "force-dynamic";

type LocalizedOpsPageProps = {
  params: Promise<{ locale: string }>;
};

export const generateMetadata = async ({ params }: LocalizedOpsPageProps): Promise<Metadata> => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  return buildPageMetadata(locale, "ops", "/ops", { index: false });
};

const LocalizedOpsPage = async ({ params }: LocalizedOpsPageProps) => {
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);
  // Diagnostics (source errors, review payloads) are administrator-only. Anonymous visitors are
  // sent to sign in and come back; a signed-in non-administrator gets an explicit forbidden state
  // (not a redirect, which would loop back here) and no data is loaded for them.
  const user = await requirePageUser(locale, buildLocalePath(locale, "/ops"));
  if (!isAdminEmail(user.email)) {
    const forbidden = dictionary.status.forbidden;
    return (
      <StatusPanel
        actions={
          <Link className="button primary" href={buildLocalePath(locale, "/discover")}>
            {forbidden.action}
          </Link>
        }
        body={forbidden.body}
        eyebrow={forbidden.eyebrow}
        title={forbidden.title}
      />
    );
  }
  const storage = await getStorage();
  const [snapshot, sourceHealth, duplicatePressure, reviewSummary, reviewQueue] = await Promise.all([
    storage.ops.snapshot(),
    storage.ops.sourceHealth(24),
    storage.ops.duplicatePressure(),
    storage.ops.reviewSummary(),
    storage.ops.reviewQueue(),
  ]);

  return (
    <main className="section-grid" style={{ paddingTop: 28 }}>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">{dictionary.ops.eyebrow}</span>
            <h1>{dictionary.ops.title}</h1>
            <p>{dictionary.ops.description}</p>
          </div>
        </div>
        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th>{dictionary.ops.table.totalTracked}</th>
                <th>{dictionary.ops.table.verified}</th>
                <th>{dictionary.ops.table.primarySourceBacked}</th>
                <th>{dictionary.ops.table.opsReading}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{snapshot.total}</td>
                <td>{snapshot.verified}</td>
                <td>{snapshot.primary}</td>
                <td>{dictionary.ops.table.opsReadingValue}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">{dictionary.ops.health.eyebrow}</span>
            <h2>{dictionary.ops.health.title}</h2>
            <p>{dictionary.ops.health.description}</p>
          </div>
        </div>
        <OpsSourceHealthTable
          duplicatePressure={duplicatePressure}
          locale={locale}
          opsDictionary={dictionary.ops}
          rows={sourceHealth}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">{dictionary.ops.review.eyebrow}</span>
            <h2>{dictionary.ops.review.title}</h2>
            <p>{dictionary.ops.review.description}</p>
          </div>
        </div>
        <OpsReviewQueue
          apiErrors={dictionary.common.apiErrors}
          initialItems={reviewQueue}
          initialSummary={reviewSummary}
          locale={locale}
          review={dictionary.ops.review}
        />
      </section>
    </main>
  );
};

export default LocalizedOpsPage;
