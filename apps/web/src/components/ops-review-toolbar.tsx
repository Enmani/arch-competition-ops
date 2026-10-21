import type { AppDictionary } from "@/i18n/dictionaries";

type Option = { label: string; value: string };

type OpsReviewToolbarProps = {
  counts: {
    accepted: number;
    active: number;
    needsFollowUp: number;
    pending: number;
    rejected: number;
  };
  dictionary: AppDictionary["ops"]["review"];
  isBusy: boolean;
  isLoading: boolean;
  onReasonChange: (value: string) => void;
  onRefresh: () => void;
  onStatusChange: (value: string) => void;
  reasonOptions: Option[];
  reasonValue: string;
  statusOptions: Option[];
  statusValue: string;
};

const OpsReviewToolbar = ({
  counts,
  dictionary,
  isBusy,
  isLoading,
  onReasonChange,
  onRefresh,
  onStatusChange,
  reasonOptions,
  reasonValue,
  statusOptions,
  statusValue,
}: OpsReviewToolbarProps) => {
  const controlsDisabled = isLoading || isBusy;
  const metrics = [
    { key: "active", label: dictionary.summary.active, value: counts.active },
    { key: "pending", label: dictionary.summary.pending, value: counts.pending },
    { key: "needsFollowUp", label: dictionary.summary.needsFollowUp, value: counts.needsFollowUp },
    { key: "accepted", label: dictionary.summary.accepted, value: counts.accepted },
    { key: "rejected", label: dictionary.summary.rejected, value: counts.rejected },
  ];

  return (
    <>
      <div className="ops-metric-grid ops-review-summary">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.key}>
            <span className="eyebrow">{metric.label}</span>
            <strong className="metric-value">{metric.value}</strong>
          </article>
        ))}
      </div>

      <div className="ops-review-toolbar">
        <label className="field-stack ops-review-filter">
          <span className="sr-only">{dictionary.filters.statusLabel}</span>
          <select
            disabled={controlsDisabled}
            onChange={(event) => onStatusChange(event.target.value)}
            value={statusValue}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field-stack ops-review-filter">
          <span className="sr-only">{dictionary.filters.reasonLabel}</span>
          <select
            disabled={controlsDisabled}
            onChange={(event) => onReasonChange(event.target.value)}
            value={reasonValue}
          >
            {reasonOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="toolbar-actions">
          <button className="button secondary" disabled={controlsDisabled} onClick={onRefresh} type="button">
            {dictionary.actions.refresh}
          </button>
        </div>
      </div>
    </>
  );
};

export default OpsReviewToolbar;
