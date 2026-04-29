import type {
  StoredDuplicatePressureSummary,
  StoredSourceHealthItem,
} from "@arch-competition/storage";

import type { AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";

type OpsSourceHealthTableProps = {
  duplicatePressure: StoredDuplicatePressureSummary;
  locale: AppLocale;
  opsDictionary: AppDictionary["ops"];
  rows: StoredSourceHealthItem[];
};

const localeCode = (locale: AppLocale) => (locale === "zh" ? "zh-CN" : "en-GB");

const formatTimestamp = (
  value: string | null,
  locale: AppLocale,
  fallback: string,
) => {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(localeCode(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const resolveFreshnessLabel = (
  row: StoredSourceHealthItem,
  dictionary: AppDictionary["ops"]["health"]["freshness"],
) => {
  if (!row.lastSuccessAt) {
    return dictionary.never;
  }

  const ageMs = Date.now() - new Date(row.lastSuccessAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours > 24 * 7) {
    return dictionary.stale;
  }
  if (ageHours > 24 * 3) {
    return dictionary.watch;
  }
  return dictionary.fresh;
};

const resolveStatusLabel = (
  status: string,
  dictionary: AppDictionary["ops"]["health"]["status"],
) => {
  switch (status) {
    case "success":
      return dictionary.success;
    case "completed_with_failures":
      return dictionary.completedWithFailures;
    case "failed":
      return dictionary.failed;
    case "empty":
      return dictionary.empty;
    default:
      return status;
  }
};

const OpsSourceHealthTable = ({
  duplicatePressure,
  locale,
  opsDictionary,
  rows,
}: OpsSourceHealthTableProps) => {
  const { duplicateSummary, health } = opsDictionary;

  return (
    <>
      <div className="ops-metric-grid" style={{ marginBottom: 24 }}>
        <article className="metric-card">
          <span className="eyebrow">{duplicateSummary.groups}</span>
          <strong className="metric-value">{duplicatePressure.duplicateGroups}</strong>
          <p>{duplicateSummary.groupsDescription}</p>
        </article>
        <article className="metric-card">
          <span className="eyebrow">{duplicateSummary.records}</span>
          <strong className="metric-value">{duplicatePressure.recordsInDuplicateGroups}</strong>
          <p>{duplicateSummary.recordsDescription}</p>
        </article>
        <article className="metric-card">
          <span className="eyebrow">{duplicateSummary.maxGroupSize}</span>
          <strong className="metric-value">{duplicatePressure.maxDuplicateGroupSize}</strong>
          <p>{duplicateSummary.maxGroupSizeDescription}</p>
        </article>
      </div>

      <div className="table-panel">
        {rows.length === 0 ? (
          <div style={{ padding: "1rem" }}>
            <strong>{health.emptyTitle}</strong>
            <p>{health.emptyBody}</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{health.table.source}</th>
                <th>{health.table.freshness}</th>
                <th>{health.table.lastRun}</th>
                <th>{health.table.volume}</th>
                <th>{health.table.parseFailures}</th>
                <th>{health.table.duplicatePressure}</th>
                <th>{health.table.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sourceId}>
                  <td>
                    <strong>{row.sourceName}</strong>
                    <br />
                    <span className="brand-caption">
                      {row.sourceId} · {row.sourceTier}
                    </span>
                  </td>
                  <td>{resolveFreshnessLabel(row, health.freshness)}</td>
                  <td>
                    {formatTimestamp(
                      row.lastRunCompletedAt ?? row.lastRunStartedAt,
                      locale,
                      health.pending,
                    )}
                  </td>
                  <td>
                    {health.volume.documents}: {row.lastDocumentCount}
                    <br />
                    {health.volume.upserted}: {row.lastUpsertedCount}
                  </td>
                  <td>{row.lastParseFailureCount}</td>
                  <td>
                    {row.duplicateGroupCount === 0 ? (
                      health.duplicate.none
                    ) : (
                      <>
                        {health.duplicate.groups}: {row.duplicateGroupCount}
                        <br />
                        {health.duplicate.maxCluster}: {row.maxDuplicateGroupSize}
                      </>
                    )}
                  </td>
                  <td>
                    {resolveStatusLabel(row.lastStatus, health.status)}
                    {row.lastError ? (
                      <>
                        <br />
                        <span className="brand-caption">{row.lastError}</span>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

export default OpsSourceHealthTable;
