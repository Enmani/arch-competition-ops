"use client";

import { DayPicker, type DateRange } from "react-day-picker";
import { enUS, zhCN } from "react-day-picker/locale";

import type { AppLocale } from "@/i18n/config";

type RangeCalendarProps = {
  locale: AppLocale;
  onSelect: (range: DateRange | undefined) => void;
  selected: DateRange | undefined;
};

/** Loaded on demand by DeadlineRange. Styling is in styles/calendar.css (theme tokens over the library's base CSS). */
const RangeCalendar = ({ locale, onSelect, selected }: RangeCalendarProps) => (
  <DayPicker
    className="dock-calendar"
    locale={locale === "zh" ? zhCN : enUS}
    mode="range"
    numberOfMonths={2}
    onSelect={onSelect}
    selected={selected}
    showOutsideDays
    weekStartsOn={1}
  />
);

export default RangeCalendar;
