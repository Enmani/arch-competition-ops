"use client";

import { useEffect, useRef, useState } from "react";

import type {
  StoredOpsReviewDecisionStatus,
  StoredOpsReviewQueueItem,
  StoredOpsReviewSummary,
} from "@arch-competition/storage";

import OpsReviewToolbar from "@/components/ops-review-toolbar";
import type { AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { DATE_TIME_FORMAT, formatLocalizedDate } from "@/i18n/format";
import { describeApiFailure, requestJson, sendJson } from "@/lib/api-client";

type QueueResponse = { items: StoredOpsReviewQueueItem[]; summary: StoredOpsReviewSummary };
type DecisionResponse = { item: StoredOpsReviewQueueItem; summary: StoredOpsReviewSummary };
type ReviewCopy = AppDictionary["ops"]["review"];

type OpsReviewQueueProps = {
  apiErrors: AppDictionary["common"]["apiErrors"];
  initialItems: StoredOpsReviewQueueItem[];
  initialSummary: StoredOpsReviewSummary;
  locale: AppLocale;
  review: ReviewCopy;
};

const REASON_LABEL_KEYS = {
  duplicate_cluster: "duplicateCluster",
  evidence_conflict: "evidenceConflict",
  low_confidence_record: "lowConfidenceRecord",
  source_parse_failures: "sourceParseFailures",
  source_run_failed: "sourceRunFailed",
  submission_pending_review: "submissionPendingReview",
} as const satisfies Record<string, keyof ReviewCopy["reasons"]>;

const STATUS_LABEL_KEYS = {
  accepted: "accepted",
  needs_follow_up: "needsFollowUp",
  pending: "pending",
  rejected: "rejected",
} as const satisfies Record<string, keyof ReviewCopy["status"]>;

const isKnown = <Key extends string>(map: Record<Key, string>, value: string): value is Key =>
  Object.prototype.hasOwnProperty.call(map, value);

const resolveReasonLabel = (reasonCode: string, reasons: ReviewCopy["reasons"]) =>
  isKnown(REASON_LABEL_KEYS, reasonCode) ? reasons[REASON_LABEL_KEYS[reasonCode]] : reasonCode;

const resolveStatusLabel = (status: string, labels: ReviewCopy["status"]) =>
  isKnown(STATUS_LABEL_KEYS, status) ? labels[STATUS_LABEL_KEYS[status]] : status;

const buildSignalLines = (item: StoredOpsReviewQueueItem, meta: ReviewCopy["meta"]) => {
  const lines: string[] = [];
  if (item.sourceId) lines.push(`${meta.source}: ${item.sourceId}`);
  if (item.competitionId) lines.push(`${meta.competition}: ${item.competitionId}`);
  if (item.noticeId) lines.push(`${meta.noticeId}: ${item.noticeId}`);
  const parseFailures = item.payload["lastParseFailureCount"];
  if (typeof parseFailures === "number") lines.push(`${meta.parseFailures}: ${parseFailures}`);
  const duplicateCount = item.payload["duplicateCount"];
  if (typeof duplicateCount === "number") lines.push(`${meta.duplicateCount}: ${duplicateCount}`);
  const confidence = item.payload["extractionConfidence"];
  if (typeof confidence === "number") lines.push(`${meta.confidence}: ${confidence.toFixed(2)}`);
  return lines;
};

const DECISIONS: Array<{ decision: StoredOpsReviewDecisionStatus; label: keyof ReviewCopy["actions"] }> = [
  { decision: "accepted", label: "accept" },
  { decision: "needs_follow_up", label: "followUp" },
  { decision: "rejected", label: "reject" },
  { decision: "pending", label: "reopen" },
];

const OpsReviewQueue = ({ apiErrors, initialItems, initialSummary, locale, review: dictionary }: OpsReviewQueueProps) => {
  const [items, setItems] = useState(initialItems);
  const [summary, setSummary] = useState(initialSummary);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(false);
  const [busyQueueId, setBusyQueueId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  const requestSequence = useRef(0);
  const skippedInitialFetch = useRef(false);

  // Latest-request-wins: a slow response for an old filter must not overwrite a newer one.
  const loadQueue = async (status: string, reason: string) => {
    const sequence = ++requestSequence.current;
    setIsLoading(true);
    setErrorMessage(null);
    const search = new URLSearchParams({ activeOnly: "true", limit: "50", reasonCode: reason, status });
    const result = await requestJson<QueueResponse>(`/api/ops/review?${search.toString()}`, { cache: "no-store" });
    if (sequence !== requestSequence.current) {
      return;
    }
    setIsLoading(false);
    if (!result.ok) {
      setErrorMessage(`${dictionary.errors.load} ${describeApiFailure(apiErrors, result.failure)}`);
      return;
    }
    setItems(result.data.items);
    setSummary(result.data.summary);
  };

  useEffect(() => {
    if (!skippedInitialFetch.current) {
      skippedInitialFetch.current = true;
      return;
    }
    void loadQueue(statusFilter, reasonFilter);
    // loadQueue only closes over stable setters and refs; the filters are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, reasonFilter]);

  const applyDecision = async (queueId: string, decision: StoredOpsReviewDecisionStatus) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusyQueueId(queueId);
    setErrorMessage(null);

    const result = await sendJson<DecisionResponse>(`/api/ops/review/${encodeURIComponent(queueId)}`, "PATCH", {
      decision,
    });
    if (result.ok) {
      const { item, summary: nextSummary } = result.data;
      const matches =
        (statusFilter === "all" || item.status === statusFilter) &&
        (reasonFilter === "all" || item.reasonCode === reasonFilter);
      setItems((current) =>
        matches
          ? current.map((entry) => (entry.queueId === queueId ? item : entry))
          : current.filter((entry) => entry.queueId !== queueId),
      );
      setSummary(nextSummary);
    } else {
      setErrorMessage(`${dictionary.errors.decision} ${describeApiFailure(apiErrors, result.failure)}`);
    }
    busyRef.current = false;
    setBusyQueueId(null);
  };

  const actionsDisabled = isLoading || busyQueueId !== null;
  const statusOptions = [
    { value: "pending", label: dictionary.filters.pending },
    { value: "needs_follow_up", label: dictionary.filters.needsFollowUp },
    { value: "accepted", label: dictionary.filters.accepted },
    { value: "rejected", label: dictionary.filters.rejected },
    { value: "all", label: dictionary.filters.allStatuses },
  ];
  const reasonOptions = [
    { value: "all", label: dictionary.filters.allReasons },
    ...Object.keys(REASON_LABEL_KEYS).map((reasonCode) => ({
      value: reasonCode,
      label: resolveReasonLabel(reasonCode, dictionary.reasons),
    })),
  ];
  const formatTimestamp = (value: string) => formatLocalizedDate(locale, value, DATE_TIME_FORMAT) ?? value;

  return (
    <>
      <OpsReviewToolbar
        counts={summary}
        dictionary={dictionary}
        isBusy={busyQueueId !== null}
        isLoading={isLoading}
        onReasonChange={(value) => !busyRef.current && setReasonFilter(value)}
        onRefresh={() => !busyRef.current && void loadQueue(statusFilter, reasonFilter)}
        onStatusChange={(value) => !busyRef.current && setStatusFilter(value)}
        reasonOptions={reasonOptions}
        reasonValue={reasonFilter}
        statusOptions={statusOptions}
        statusValue={statusFilter}
      />

      {errorMessage ? (
        <p className="ops-review-error" role="alert">
          {errorMessage}{" "}
          <button
            className="button secondary"
            onClick={() => void loadQueue(statusFilter, reasonFilter)}
            type="button"
          >
            {dictionary.actions.refresh}
          </button>
        </p>
      ) : null}

      <div aria-busy={isLoading} className="table-panel">
        {items.length === 0 ? (
          <div className="ops-review-empty" role="status">
            <strong>{dictionary.empty.title}</strong>
            <p>{dictionary.empty.body}</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">{dictionary.table.record}</th>
                <th scope="col">{dictionary.table.reason}</th>
                <th scope="col">{dictionary.table.detected}</th>
                <th scope="col">{dictionary.table.status}</th>
                <th scope="col">{dictionary.table.actions}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const signalLines = buildSignalLines(item, dictionary.meta);

                return (
                  <tr key={item.queueId}>
                    <td>
                      <strong>{item.title}</strong>
                      <p className="ops-review-summary-text">{item.summary}</p>
                      {signalLines.length > 0 ? (
                        <div className="ops-review-meta">
                          {signalLines.map((line) => (
                            <span className="brand-caption" key={line}>
                              {line}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {item.evidenceNote ? <p className="brand-caption ops-review-note">{item.evidenceNote}</p> : null}
                    </td>
                    <td>
                      <span className="pill ops-review-reason">{resolveReasonLabel(item.reasonCode, dictionary.reasons)}</span>
                    </td>
                    <td>
                      <strong>{formatTimestamp(item.lastDetectedAt)}</strong>
                      <br />
                      <span className="brand-caption">{item.isActive ? dictionary.meta.active : dictionary.meta.inactive}</span>
                      {item.latestDecision ? (
                        <>
                          <br />
                          <span className="brand-caption">
                            {dictionary.meta.latestDecision}: {resolveStatusLabel(item.latestDecision.decision, dictionary.status)}
                          </span>
                          <br />
                          <span className="brand-caption">{formatTimestamp(item.latestDecision.createdAt)}</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <span className={`pill ops-review-status status-${item.status}`}>
                        {resolveStatusLabel(item.status, dictionary.status)}
                      </span>
                    </td>
                    <td>
                      <div className="ops-review-actions">
                        {DECISIONS.map(({ decision, label }) => (
                          <button
                            className="button secondary"
                            disabled={actionsDisabled || item.status === decision}
                            key={decision}
                            onClick={() => void applyDecision(item.queueId, decision)}
                            type="button"
                          >
                            {dictionary.actions[label]}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

export default OpsReviewQueue;
