"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  StoredOpsReviewDecisionStatus,
  StoredOpsReviewQueueItem,
  StoredOpsReviewSummary,
} from "@arch-competition/storage/cloudflare";

import OpsReviewToolbar from "@/components/ops-review-toolbar";
import type { AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";

type QueueResponse = {
  items: StoredOpsReviewQueueItem[];
  summary: StoredOpsReviewSummary;
};

type LoadQueueOptions = {
  preserveError?: boolean;
};

const reviewReasonCodes = [
  "source_parse_failures",
  "source_run_failed",
  "duplicate_cluster",
  "low_confidence_record",
  "evidence_conflict",
  "submission_pending_review",
] as const;

type OpsReviewQueueProps = {
  initialItems: StoredOpsReviewQueueItem[];
  initialSummary: StoredOpsReviewSummary;
  locale: AppLocale;
  opsDictionary: AppDictionary["ops"];
  reviewEnabled: boolean;
};

const localeCode = (locale: AppLocale) => (locale === "zh" ? "zh-CN" : "en-GB");

const formatTimestamp = (value: string, locale: AppLocale) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(localeCode(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const resolveStatusLabel = (
  status: string,
  dictionary: AppDictionary["ops"]["review"]["status"],
) => {
  switch (status) {
    case "pending":
      return dictionary.pending;
    case "accepted":
      return dictionary.accepted;
    case "rejected":
      return dictionary.rejected;
    case "needs_follow_up":
      return dictionary.needsFollowUp;
    default:
      return status;
  }
};

const resolveReasonLabel = (
  reasonCode: string,
  dictionary: AppDictionary["ops"]["review"]["reasons"],
) => {
  switch (reasonCode) {
    case "source_parse_failures":
      return dictionary.sourceParseFailures;
    case "source_run_failed":
      return dictionary.sourceRunFailed;
    case "duplicate_cluster":
      return dictionary.duplicateCluster;
    case "low_confidence_record":
      return dictionary.lowConfidenceRecord;
    case "evidence_conflict":
      return dictionary.evidenceConflict;
    case "submission_pending_review":
      return dictionary.submissionPendingReview;
    default:
      return reasonCode;
  }
};

const buildSignalLines = (
  item: StoredOpsReviewQueueItem,
  dictionary: AppDictionary["ops"]["review"]["meta"],
) => {
  const lines: string[] = [];

  if (item.sourceId) {
    lines.push(`${dictionary.source}: ${item.sourceId}`);
  }
  if (item.competitionId) {
    lines.push(`${dictionary.competition}: ${item.competitionId}`);
  }
  if (item.noticeId) {
    lines.push(`${dictionary.noticeId}: ${item.noticeId}`);
  }
  const parseFailures = item.payload["lastParseFailureCount"];
  if (typeof parseFailures === "number") {
    lines.push(`${dictionary.parseFailures}: ${parseFailures}`);
  }
  const duplicateCount = item.payload["duplicateCount"];
  if (typeof duplicateCount === "number") {
    lines.push(`${dictionary.duplicateCount}: ${duplicateCount}`);
  }
  const extractionConfidence = item.payload["extractionConfidence"];
  if (typeof extractionConfidence === "number") {
    lines.push(`${dictionary.confidence}: ${extractionConfidence.toFixed(2)}`);
  }

  return lines;
};

const OpsReviewQueue = ({
  initialItems,
  initialSummary,
  locale,
  opsDictionary,
  reviewEnabled,
}: OpsReviewQueueProps) => {
  const dictionary = opsDictionary.review;
  const [items, setItems] = useState(initialItems);
  const [summary, setSummary] = useState(initialSummary);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [busyQueueId, setBusyQueueId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const skippedInitialFetch = useRef(false);
  const busyQueueIdRef = useRef<string | null>(null);

  const loadQueue = useCallback(
    async (nextStatus: string, nextReason: string, options?: LoadQueueOptions) => {
      setIsLoading(true);
      if (!options?.preserveError) {
        setErrorMessage(null);
      }

      try {
        const searchParams = new URLSearchParams({
          activeOnly: "true",
          limit: "50",
          reasonCode: nextReason,
          status: nextStatus,
        });
        const response = await fetch(`/api/ops/review?${searchParams.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as QueueResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || dictionary.errors.load);
        }

        setItems(payload.items);
        setSummary(payload.summary);
        return true;
      } catch {
        if (!options?.preserveError) {
          setErrorMessage(dictionary.errors.load);
        }
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [dictionary.errors.load],
  );

  const handleStatusChange = useCallback((nextStatus: string) => {
    if (busyQueueIdRef.current !== null) {
      return;
    }

    setStatusFilter(nextStatus);
  }, []);

  const handleReasonChange = useCallback((nextReason: string) => {
    if (busyQueueIdRef.current !== null) {
      return;
    }

    setReasonFilter(nextReason);
  }, []);

  const handleRefresh = useCallback(() => {
    if (busyQueueIdRef.current !== null) {
      return;
    }

    void loadQueue(statusFilter, reasonFilter);
  }, [loadQueue, reasonFilter, statusFilter]);

  const applyDecision = useCallback(
    async (queueId: string, decision: StoredOpsReviewDecisionStatus) => {
      if (busyQueueIdRef.current !== null) {
        return;
      }

      busyQueueIdRef.current = queueId;
      setBusyQueueId(queueId);
      setErrorMessage(null);

      try {
        const response = await fetch(`/api/ops/review/${encodeURIComponent(queueId)}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ decision }),
        });
        const payload = (await response.json()) as
          | { error?: string; item: StoredOpsReviewQueueItem; summary: StoredOpsReviewSummary }
          | { error?: string };

        if (!response.ok || !("item" in payload) || !("summary" in payload)) {
          throw new Error(("error" in payload && payload.error) || dictionary.errors.decision);
        }

        setItems((currentItems) => {
          const nextItems = currentItems.map((item) =>
            item.queueId === queueId ? payload.item : item,
          );
          const matchesStatus = statusFilter === "all" || payload.item.status === statusFilter;
          const matchesReason = reasonFilter === "all" || payload.item.reasonCode === reasonFilter;

          return matchesStatus && matchesReason
            ? nextItems
            : nextItems.filter((item) => item.queueId !== queueId);
        });
        setSummary(payload.summary);
        const reloaded = await loadQueue(statusFilter, reasonFilter, { preserveError: true });

        if (!reloaded) {
          setErrorMessage(dictionary.errors.load);
        }
      } catch {
        setErrorMessage(dictionary.errors.decision);
      } finally {
        if (busyQueueIdRef.current === queueId) {
          busyQueueIdRef.current = null;
        }
        setBusyQueueId((currentQueueId) => (currentQueueId === queueId ? null : currentQueueId));
      }
    },
    [dictionary.errors.decision, dictionary.errors.load, loadQueue, reasonFilter, statusFilter],
  );

  useEffect(() => {
    if (!skippedInitialFetch.current) {
      skippedInitialFetch.current = true;
      return;
    }

    void loadQueue(statusFilter, reasonFilter);
  }, [loadQueue, reasonFilter, statusFilter]);

  const queueWriteBusy = busyQueueId !== null;

  const statusOptions = [
    { value: "pending", label: dictionary.filters.pending },
    { value: "needs_follow_up", label: dictionary.filters.needsFollowUp },
    { value: "accepted", label: dictionary.filters.accepted },
    { value: "rejected", label: dictionary.filters.rejected },
    { value: "all", label: dictionary.filters.allStatuses },
  ];
  const reasonOptions = [
    { value: "all", label: dictionary.filters.allReasons },
    ...reviewReasonCodes.map((reasonCode) => ({
      value: reasonCode,
      label: resolveReasonLabel(reasonCode, dictionary.reasons),
    })),
  ];

  return (
    <>
      <OpsReviewToolbar
        counts={{
          active: summary.active,
          pending: summary.pending,
          needsFollowUp: summary.needsFollowUp,
          accepted: summary.accepted,
          rejected: summary.rejected,
        }}
        dictionary={dictionary}
        isBusy={queueWriteBusy}
        isLoading={isLoading}
        onReasonChange={handleReasonChange}
        onRefresh={handleRefresh}
        onStatusChange={handleStatusChange}
        reasonOptions={reasonOptions}
        reasonValue={reasonFilter}
        reviewEnabled={reviewEnabled}
        statusOptions={statusOptions}
        statusValue={statusFilter}
      />

      {!reviewEnabled ? (
        <div className="ops-review-readonly">
          <strong>{dictionary.readOnly.title}</strong>
          <p>{dictionary.readOnly.body}</p>
        </div>
      ) : null}

      {errorMessage ? <p className="ops-review-error">{errorMessage}</p> : null}

      <div className="table-panel">
        {items.length === 0 ? (
          <div className="ops-review-empty">
            <strong>{dictionary.empty.title}</strong>
            <p>{dictionary.empty.body}</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{dictionary.table.record}</th>
                <th>{dictionary.table.reason}</th>
                <th>{dictionary.table.detected}</th>
                <th>{dictionary.table.status}</th>
                <th>{dictionary.table.actions}</th>
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
                      {item.evidenceNote ? (
                        <p className="brand-caption ops-review-note">{item.evidenceNote}</p>
                      ) : null}
                    </td>
                    <td>
                      <span className="pill ops-review-reason">
                        {resolveReasonLabel(item.reasonCode, dictionary.reasons)}
                      </span>
                    </td>
                    <td>
                      <strong>{formatTimestamp(item.lastDetectedAt, locale)}</strong>
                      <br />
                      <span className="brand-caption">
                        {item.isActive ? dictionary.meta.active : dictionary.meta.inactive}
                      </span>
                      {item.latestDecision ? (
                        <>
                          <br />
                          <span className="brand-caption">
                            {dictionary.meta.latestDecision}:{" "}
                            {resolveStatusLabel(item.latestDecision.decision, dictionary.status)}
                          </span>
                          <br />
                          <span className="brand-caption">
                            {formatTimestamp(item.latestDecision.createdAt, locale)}
                          </span>
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
                        <button
                          className="button secondary"
                          disabled={
                            !reviewEnabled || isLoading || queueWriteBusy || item.status === "accepted"
                          }
                          onClick={() => void applyDecision(item.queueId, "accepted")}
                          type="button"
                        >
                          {dictionary.actions.accept}
                        </button>
                        <button
                          className="button secondary"
                          disabled={
                            !reviewEnabled
                            || isLoading
                            || queueWriteBusy
                            || item.status === "needs_follow_up"
                          }
                          onClick={() => void applyDecision(item.queueId, "needs_follow_up")}
                          type="button"
                        >
                          {dictionary.actions.followUp}
                        </button>
                        <button
                          className="button secondary"
                          disabled={
                            !reviewEnabled || isLoading || queueWriteBusy || item.status === "rejected"
                          }
                          onClick={() => void applyDecision(item.queueId, "rejected")}
                          type="button"
                        >
                          {dictionary.actions.reject}
                        </button>
                        <button
                          className="button secondary"
                          disabled={
                            !reviewEnabled || isLoading || queueWriteBusy || item.status === "pending"
                          }
                          onClick={() => void applyDecision(item.queueId, "pending")}
                          type="button"
                        >
                          {dictionary.actions.reopen}
                        </button>
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
