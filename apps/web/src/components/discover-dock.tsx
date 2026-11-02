"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import type { StoredFilterOptions, StoredOpportunityQuery } from "@arch-competition/storage";

import { serializeSearchParams, type AppLocale } from "@/i18n/config";
import { translateMappedValue } from "@/i18n/format";
import type { DiscoverDockCopy } from "@/i18n/slices";
import {
  DISCOVER_FILTER_FORM_ID,
  buildDiscoverPageSearchParams,
  collectDiscoverSearchParams,
  formatTokenLabel,
  readDiscoverPageState,
} from "@/lib/discover";
import { requestFeedTopReset } from "@/lib/discover-navigation";
import { DeadlineRange } from "@/components/deadline-range";
import { SaveSearchForm } from "@/components/save-search-form";

type DiscoverDockProps = {
  activeFilterCount: number;
  copy: DiscoverDockCopy;
  filterOptions: StoredFilterOptions;
  filters: StoredOpportunityQuery;
  locale: AppLocale;
  routeBase: string;
  signedIn: boolean;
};

// Ticking several boxes in a row becomes one navigation, not one per tick. A single choice (radio,
// select) applies at once: there is nothing to wait for.
const AUTO_APPLY_DELAY_MS = 250;

const isChecked = (values: readonly string[] | undefined, value: string) => values?.includes(value) ?? false;
const present = (value: unknown) => (value === undefined || value === null || value === "" ? 0 : 1);

type CheckListProps = {
  checked: readonly string[] | undefined;
  labels: Record<string, string>;
  name: string;
  values: readonly string[];
};

/**
 * A multi-select facet: native checkboxes in menu-like columns, submitted as repeated query params.
 * The box itself is drawn by CSS: it appears in front of an option on hover or focus and stays once
 * the option is selected, so an unselected list carries no checkbox clutter.
 */
const CheckList = ({ checked, labels, name, values }: CheckListProps) => (
  <div className="dock-options">
    {values.map((value) => (
      <label className="dock-option" key={value}>
        <input defaultChecked={isChecked(checked, value)} name={name} type="checkbox" value={value} />
        <span>{translateMappedValue(value, labels, formatTokenLabel(value))}</span>
      </label>
    ))}
  </div>
);

type RadioListProps = {
  current: string | undefined;
  name: string;
  options: readonly { label: string; value: string }[];
};

/** A single choice with an explicit "any" entry (empty value, dropped from the URL). */
const RadioList = ({ current, name, options }: RadioListProps) => (
  <div className="dock-options">
    {options.map((option) => (
      <label className="dock-option" key={option.value}>
        <input defaultChecked={(current ?? "") === option.value} name={name} type="radio" value={option.value} />
        <span>{option.label}</span>
      </label>
    ))}
  </div>
);

/** A group with a visible label, so two similar groups (procedure / route) stay distinguishable. */
const Group = ({ children, label }: { children: ReactNode; label: string }) => (
  <fieldset className="dock-group">
    <legend className="dock-label">{label}</legend>
    {children}
  </fieldset>
);

/** A control with a visible label, so two similar inputs (deadline after / before) stay distinguishable. */
const Field = ({ children, label }: { children: ReactNode; label: string }) => (
  <label className="field-stack dock-field">
    <span className="dock-label">{label}</span>
    {children}
  </label>
);

type SelectOptionsProps = {
  allLabel: string;
  labels: Record<string, string>;
  values: readonly string[];
};

const SelectOptions = ({ allLabel, labels, values }: SelectOptionsProps) => (
  <>
    <option value="">{allLabel}</option>
    {values.map((value) => (
      <option key={value} value={value}>
        {translateMappedValue(value, labels, formatTokenLabel(value))}
      </option>
    ))}
  </>
);

type NumberFieldProps = {
  defaultValue: number | undefined;
  label: string;
  max?: number;
  name: string;
  step: number;
};

const NumberField = ({ defaultValue, label, max, name, step }: NumberFieldProps) => (
  <Field label={label}>
    <input
      defaultValue={defaultValue?.toString() ?? ""}
      inputMode="numeric"
      max={max}
      min="0"
      name={name}
      step={step}
      type="number"
    />
  </Field>
);

type PillProps = {
  children: ReactNode;
  count: number;
  id: string;
  label: string;
  onOpenChange: (id: string, isOpen: boolean) => void;
  openId: string | null;
};

/** One filter: a pill that opens its panel. Open state lives in the parent so only one is open at a time. */
const Pill = ({ children, count, id, label, onOpenChange, openId }: PillProps) => (
  <details
    className={`dock-pill${count > 0 ? " is-active" : ""}`}
    onToggle={(event) => onOpenChange(id, event.currentTarget.open)}
    open={openId === id}
  >
    <summary className="dock-pill-summary">
      <span>{label}</span>
      {count > 0 ? <span className="dock-count">{count}</span> : null}
      <span aria-hidden="true" className="dock-chevron" />
    </summary>
    <div className="dock-panel">{children}</div>
  </details>
);

export const DiscoverDock = ({
  activeFilterCount,
  copy,
  filterOptions,
  filters,
  locale,
  routeBase,
  signedIn,
}: DiscoverDockProps) => {
  const router = useRouter();
  const { discover: text, taxonomy } = copy;
  const [openId, setOpenId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const applyTimer = useRef<number | undefined>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const formStateKey = serializeSearchParams(buildDiscoverPageSearchParams(filters)) || "none";

  // The fields already show what the visitor chose, so a navigation they started must not rebuild
  // the form: that would drop focus, the calendar's month and the scroll inside an open panel.
  // The form is rebuilt only when the URL changes for another reason: Reset, back, a link.
  const expectedKey = useRef(formStateKey);
  const [syncKey, setSyncKey] = useState(0);
  useEffect(() => {
    // While a navigation is in flight the URL is momentarily an older choice, not an outside change.
    if (isPending || formStateKey === expectedKey.current) {
      return;
    }
    expectedKey.current = formStateKey;
    setSyncKey((current) => current + 1);
  }, [formStateKey, isPending]);

  const handleOpenChange = (id: string, isOpen: boolean) =>
    setOpenId((current) => (isOpen ? id : current === id ? null : current));

  // A panel closes on a click anywhere else and on Escape.
  useEffect(() => {
    if (openId === null) {
      return;
    }
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".dock-pill")) {
        setOpenId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenId(null);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openId]);

  useEffect(() => () => window.clearTimeout(applyTimer.current), []);

  const scheduleApply = (form: HTMLFormElement) => {
    window.clearTimeout(applyTimer.current);
    applyTimer.current = window.setTimeout(() => form.requestSubmit(), AUTO_APPLY_DELAY_MS);
  };

  const recencyOptions = [
    { label: text.filterOptions.anyCaptureDate, value: "" },
    { label: text.filterOptions.last7Days, value: "7" },
    { label: text.filterOptions.last30Days, value: "30" },
    { label: text.filterOptions.last90Days, value: "90" },
    { label: text.filterOptions.last365Days, value: "365" },
  ];
  const optionList = (allLabel: string, labels: Record<string, string>, values: readonly string[]) => [
    { label: allLabel, value: "" },
    ...values.map((value) => ({
      label: translateMappedValue(value, labels, formatTokenLabel(value)),
      value,
    })),
  ];
  const sortOptions = [
    { label: text.filterOptions.sortByDeadline, value: "deadline" },
    { label: text.filterOptions.sortByLatest, value: "latest" },
    { label: text.filterOptions.sortByContractValue, value: "highest_value" },
  ];

  const facets = [
    {
      checked: filters.projectTypes,
      id: "projectType",
      label: text.filterLabels.projectType,
      labels: taxonomy.projectTypes,
      values: filterOptions.projectTypes,
    },
    {
      checked: filters.buildingCategories,
      id: "buildingCategory",
      label: text.filterLabels.buildingCategory,
      labels: taxonomy.buildingCategories,
      values: filterOptions.buildingCategories,
    },
    {
      checked: filters.designScopes,
      id: "designScope",
      label: text.filterLabels.designScope,
      labels: taxonomy.designScopes,
      values: filterOptions.designScopes,
    },
    {
      checked: filters.projectModes,
      id: "projectMode",
      label: text.filterLabels.projectMode,
      labels: taxonomy.projectModes,
      values: filterOptions.projectModes,
    },
  ];

  const handleSubmit = (formData: FormData) => {
    const rawSearchParams = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string" && value.trim()) {
        rawSearchParams.append(key, value.trim());
      }
    }

    // Round-trip through the same parser as the server, so the URL only ever holds valid filters.
    const { filters: nextFilters } = readDiscoverPageState(collectDiscoverSearchParams(rawSearchParams));
    const nextSearch = serializeSearchParams(buildDiscoverPageSearchParams(nextFilters));
    const nextHref = `${routeBase}${nextSearch}`;
    expectedKey.current = nextSearch || "none";
    requestFeedTopReset();

    // push (not replace): the back button returns to the previous filter set.
    startTransition(() => {
      router.push(nextHref, { scroll: false });
    });
  };

  return (
    <section aria-busy={isPending} className={`discover-dock${isPending ? " is-pending" : ""}`}>
      <form
        action={routeBase}
        className="filter-form"
        id={DISCOVER_FILTER_FORM_ID}
        ref={formRef}
        key={syncKey}
        method="GET"
        onBlur={(event) => {
          // A number is committed when the field is left; typing must not navigate on every digit.
          const target = event.target;
          if (target instanceof HTMLInputElement && target.type === "number" && target.value !== target.defaultValue) {
            scheduleApply(event.currentTarget);
          }
        }}
        onChange={(event) => {
          // Choices apply by themselves. The search box waits for Enter; selects apply in their own handler.
          const target = event.target;
          if (target instanceof HTMLInputElement && target.type === "radio") {
            event.currentTarget.requestSubmit();
          } else if (target instanceof HTMLInputElement && target.type === "checkbox") {
            scheduleApply(event.currentTarget);
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          window.clearTimeout(applyTimer.current);
          handleSubmit(new FormData(event.currentTarget));
        }}
      >
        {/* A form without a submit button does not submit on Enter once it has several fields; the
            search box (outside this element) and the number fields rely on that. */}
        <button hidden type="submit" />

        <div className="dock-pills">
          <label className="field-stack dock-country">
            <span className="sr-only">{text.filterLabels.country}</span>
            <select
              defaultValue={filters.jurisdiction ?? ""}
              name="jurisdiction"
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <SelectOptions
                allLabel={text.filterOptions.allCountries}
                labels={taxonomy.jurisdictions}
                values={filterOptions.jurisdictions}
              />
            </select>
          </label>

          {facets
            // A facet with no known values would open an empty panel; leave it out.
            .filter((facet) => facet.values.length > 0)
            .map((facet) => (
              <Pill
                count={facet.checked?.length ?? 0}
                id={facet.id}
                key={facet.id}
                label={facet.label}
                onOpenChange={handleOpenChange}
                openId={openId}
              >
                <CheckList checked={facet.checked} labels={facet.labels} name={facet.id} values={facet.values} />
              </Pill>
            ))}

          <Pill
            count={present(filters.publishedWithinDays) + (filters.deadlineAfter || filters.deadlineBefore ? 1 : 0)}
            id="dates"
            label={text.filterGroups.dates}
            onOpenChange={handleOpenChange}
            openId={openId}
          >
            <div className="dock-columns">
              <Group label={text.filterLabels.capturedWithin}>
                <RadioList
                  current={filters.publishedWithinDays?.toString()}
                  name="publishedWithinDays"
                  options={recencyOptions}
                />
              </Group>
              <Group label={text.filterLabels.deadline}>
                <DeadlineRange
                  after={filters.deadlineAfter}
                  before={filters.deadlineBefore}
                  calendarOpen={openId === "dates"}
                  clearLabel={text.buttons.clearDates}
                  locale={locale}
                  onCommit={() => formRef.current && scheduleApply(formRef.current)}
                />
              </Group>
            </div>
          </Pill>

          <Pill
            count={present(filters.procedureType) + present(filters.implementationPath)}
            id="procedure"
            label={text.filterGroups.procedure}
            onOpenChange={handleOpenChange}
            openId={openId}
          >
            <div className="dock-columns">
              <Group label={text.filterLabels.procedureType}>
                <RadioList
                  current={filters.procedureType}
                  name="procedureType"
                  options={optionList(
                    text.filterOptions.allProcedureTypes,
                    taxonomy.procedures,
                    filterOptions.procedureTypes,
                  )}
                />
              </Group>
              <Group label={text.filterLabels.implementationPath}>
                <RadioList
                  current={filters.implementationPath}
                  name="implementationPath"
                  options={optionList(
                    text.filterOptions.allImplementationPaths,
                    taxonomy.implementationPaths,
                    filterOptions.implementationPaths,
                  )}
                />
              </Group>
            </div>
          </Pill>

          <Pill
            count={present(filters.minEstimatedValueEur) + present(filters.maxEstimatedValueEur)}
            id="value"
            label={text.filterGroups.value}
            onOpenChange={handleOpenChange}
            openId={openId}
          >
            <div className="dock-columns">
              <NumberField
                defaultValue={filters.minEstimatedValueEur}
                label={text.filterLabels.minValue}
                name="minEstimatedValueEur"
                step={10000}
              />
              <NumberField
                defaultValue={filters.maxEstimatedValueEur}
                label={text.filterLabels.maxValue}
                name="maxEstimatedValueEur"
                step={10000}
              />
            </div>
          </Pill>

          <Pill
            count={present(filters.minQualificationScore) + (filters.licensedArchitectRequired === true ? 1 : 0)}
            id="qualification"
            label={text.filterGroups.qualification}
            onOpenChange={handleOpenChange}
            openId={openId}
          >
            <div className="dock-columns">
              <NumberField
                defaultValue={filters.minQualificationScore}
                label={text.filterLabels.minQualificationScore}
                max={100}
                name="minQualificationScore"
                step={1}
              />
              <div className="dock-options">
                <label className="dock-option">
                  <input
                    defaultChecked={filters.licensedArchitectRequired === true}
                    name="licensedArchitectRequired"
                    type="checkbox"
                    value="true"
                  />
                  <span>{text.filterOptions.requireLicensedArchitect}</span>
                </label>
              </div>
            </div>
          </Pill>

          <label className="dock-toggle-pill">
            <input defaultChecked={filters.includeExpired === true} name="includeExpired" type="checkbox" value="true" />
            <span>{text.filterGroups.expired}</span>
          </label>

          {activeFilterCount > 0 ? (
            isPending ? (
              <span aria-disabled="true" className="dock-reset" role="link">
                {text.buttons.resetFilters}
              </span>
            ) : (
              <Link className="dock-reset" href={routeBase}>
                {text.buttons.resetFilters}
              </Link>
            )
          ) : null}

        <label className="field-stack dock-sort">
          <span className="sr-only">{text.filterLabels.sort}</span>
          <select
            defaultValue={filters.sort ?? "deadline"}
            name="sort"
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        </div>
      </form>

      {signedIn && activeFilterCount > 0 ? <SaveSearchForm copy={copy.saved} filters={filters} /> : null}
    </section>
  );
};
