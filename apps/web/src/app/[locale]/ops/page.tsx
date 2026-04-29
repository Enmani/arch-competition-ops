import {
  getStoredDuplicatePressureSummary,
  getStoredOpsSnapshot,
  getStoredOpsReviewSummary,
  getStoredSourceHealth,
  queryStoredOpsReviewQueue,
} from "@arch-competition/storage";

import OpsReviewQueue from "@/components/ops-review-queue";
import OpsSourceHealthTable from "@/components/ops-source-health-table";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { isOpsReviewEnabled } from "@/lib/ops-review-access";

export const dynamic = "force-dynamic";

type LocalizedOpsPageProps = {
  params: Promise<{ locale: string }>;
};

const LocalizedOpsPage = async ({ params }: LocalizedOpsPageProps) => {
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);
  const snapshot = getStoredOpsSnapshot();
  const sourceHealth = getStoredSourceHealth(24);
  const duplicatePressure = getStoredDuplicatePressureSummary();
  const reviewSummary = getStoredOpsReviewSummary();
  const reviewQueue = queryStoredOpsReviewQueue();
  const reviewEnabled = isOpsReviewEnabled();

  return (
    <main className="section-grid" style={{ paddingTop: 28 }}>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">{dictionary.ops.eyebrow}</span>
            <h2>{dictionary.ops.title}</h2>
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
          initialItems={reviewQueue}
          initialSummary={reviewSummary}
          locale={locale}
          opsDictionary={dictionary.ops}
          reviewEnabled={reviewEnabled}
        />
      </section>
    </main>
  );
};

export default LocalizedOpsPage;
