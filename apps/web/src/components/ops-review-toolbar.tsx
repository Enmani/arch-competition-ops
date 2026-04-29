import type { AppDictionary } from "@/i18n/dictionaries";

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
  reasonOptions: Array<{
    label: string;
    value: string;
  }>;
  reasonValue: string;
  reviewEnabled: boolean;
  statusOptions: Array<{
    label: string;
    value: string;
  }>;
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
  reviewEnabled,
  statusOptions,
  statusValue,
}: OpsReviewToolbarProps) => {
  const controlsDisabled = isLoading || isBusy;

  return (
    <>
      <div className="ops-metric-grid ops-review-summary">
        <article className="metric-card">
          <span className="eyebrow">{dictionary.summary.active}</span>
          <strong className="metric-value">{counts.active}</strong>
        </article>
        <article className="metric-card">
          <span className="eyebrow">{dictionary.summary.pending}</span>
          <strong className="metric-value">{counts.pending}</strong>
        </article>
        <article className="metric-card">
          <span className="eyebrow">{dictionary.summary.needsFollowUp}</span>
          <strong className="metric-value">{counts.needsFollowUp}</strong>
        </article>
        <article className="metric-card">
          <span className="eyebrow">{dictionary.summary.accepted}</span>
          <strong className="metric-value">{counts.accepted}</strong>
        </article>
        <article className="metric-card">
          <span className="eyebrow">{dictionary.summary.rejected}</span>
          <strong className="metric-value">{counts.rejected}</strong>
        </article>
      </div>

      <div className="ops-review-toolbar">
        <label className="field-stack ops-review-filter">
          <span className="sr-only">{dictionary.filters.statusLabel}</span>
          <select
            aria-label={dictionary.filters.statusLabel}
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
            aria-label={dictionary.filters.reasonLabel}
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
          <button
            className="button secondary"
            disabled={controlsDisabled}
            onClick={onRefresh}
            type="button"
          >
            {dictionary.actions.refresh}
          </button>
        </div>

        <p className="brand-caption ops-review-mode">
          {reviewEnabled ? dictionary.mode.enabled : dictionary.mode.readOnly}
        </p>
      </div>
    </>
  );
};

export default OpsReviewToolbar;
