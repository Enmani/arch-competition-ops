"use client";

import type { McpUsage } from "@arch-competition/core";

import type { AppLocale } from "@/i18n/config";
import { fillTemplate, getIntlLocale } from "@/i18n/format";
import type { McpAccountCopy } from "@/i18n/slices";
import { usageAdvice, usageLevel, usagePercent } from "@/lib/mcp-account";
import { useIsClient } from "@/lib/use-is-client";

type McpUsageMetersProps = {
  copy: McpAccountCopy;
  loading: boolean;
  locale: AppLocale;
  onRefresh: () => void;
  usage: McpUsage;
};

/** Month and minute windows as meters, with the reset time in the viewer's own time zone. */
export const McpUsageMeters = ({ copy, loading, locale, onRefresh, usage }: McpUsageMetersProps) => {
  const text = copy.account.usage;
  const isClient = useIsClient();
  const number = new Intl.NumberFormat(getIntlLocale(locale));
  const windows = [
    { id: "month", label: text.month, window: usage.month, format: { dateStyle: "medium", timeStyle: "short" } },
    { id: "minute", label: text.minute, window: usage.minute, format: { timeStyle: "medium" } },
  ] as const;
  const advice = usageAdvice(usage);

  return (
    <section aria-busy={loading} aria-labelledby="mcp-usage-title" className="mcp-block mcp-usage" id="mcp-usage">
      <div className="mcp-block-head">
        <h3 id="mcp-usage-title">{text.title}</h3>
        <button
          aria-busy={loading}
          className="button secondary"
          disabled={loading}
          onClick={onRefresh}
          type="button"
        >
          {loading ? text.loading : text.refresh}
        </button>
      </div>
      {windows.map(({ id, label, window, format }) => {
        const level = usageLevel(window);
        const count = fillTemplate(text.count, { limit: number.format(window.limit), used: number.format(window.used) });
        return (
          <div className={`mcp-meter is-${level}`} key={id}>
            <div className="mcp-meter-head">
              <span id={`mcp-meter-${id}`}>{label}</span>
              <span className="mcp-meter-count">{count}</span>
            </div>
            <div
              aria-labelledby={`mcp-meter-${id}`}
              aria-valuemax={window.limit}
              aria-valuemin={0}
              aria-valuenow={Math.min(window.used, window.limit)}
              aria-valuetext={count}
              className="mcp-meter-track"
              role="meter"
            >
              <span style={{ width: `${usagePercent(window)}%` }} />
            </div>
            <div className="mcp-meter-foot">
              <span>
                {isClient
                  ? fillTemplate(text.resets, {
                      time: new Intl.DateTimeFormat(getIntlLocale(locale), format).format(new Date(window.resetsAt)),
                    })
                  : " "}
              </span>
              {level === "ok" ? null : <span className="mcp-meter-state">{level === "full" ? text.full : text.near}</span>}
            </div>
          </div>
        );
      })}
      {advice === "upgrade" || advice === "waitReset" ? (
        <p className="mcp-note" role="status">
          {advice === "upgrade" ? (
            <a className="inline-link" href="#mcp-plan">
              {text.upgrade}
            </a>
          ) : (
            text.waitReset
          )}
        </p>
      ) : null}
    </section>
  );
};
