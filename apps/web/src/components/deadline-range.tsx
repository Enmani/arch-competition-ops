"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

import type { AppLocale } from "@/i18n/config";

// The calendar is the heaviest part of the filters and is only needed once a visitor opens "Dates".
const RangeCalendar = dynamic(() => import("@/components/range-calendar"), { ssr: false });

type DeadlineRangeProps = {
  after: string | undefined;
  before: string | undefined;
  calendarOpen: boolean;
  clearLabel: string;
  /** Called after every change; the dock debounces it, so a quick second click is one navigation. */
  onCommit: () => void;
  locale: AppLocale;
};

const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** `YYYY-MM-DD` as a local date; `new Date(iso)` would read it as UTC and can land on the day before. */
const fromIso = (value: string | undefined) => {
  const [year, month, day] = (value ?? "").split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : undefined;
};

/**
 * The deadline window: one calendar that picks a range, written to the two hidden fields the server
 * reads (`deadlineAfter`, `deadlineBefore`). Unlike a native date input it follows the page's
 * language, not the browser's, and looks the same everywhere. The fields are always rendered, so the
 * filter works before the calendar has loaded.
 */
export const DeadlineRange = ({ after, before, calendarOpen, clearLabel, locale, onCommit }: DeadlineRangeProps) => {
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = fromIso(after);
    return from ? { from, to: fromIso(before) } : undefined;
  });
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const summary = range?.from
    ? `${format.format(range.from)} – ${range.to ? format.format(range.to) : "…"}`
    : null;

  return (
    <div className="dock-range">
      <input name="deadlineAfter" type="hidden" value={range?.from ? toIso(range.from) : ""} />
      <input name="deadlineBefore" type="hidden" value={range?.to ? toIso(range.to) : ""} />
      {calendarOpen ? (
        <RangeCalendar
          locale={locale}
          onSelect={(next) => {
            setRange(next);
            onCommit();
          }}
          selected={range}
        />
      ) : null}
      {summary ? (
        <p className="dock-range-summary">
          <span>{summary}</span>
          <button
            className="inline-link"
            onClick={() => {
              setRange(undefined);
              onCommit();
            }}
            type="button"
          >
            {clearLabel}
          </button>
        </p>
      ) : null}
    </div>
  );
};
