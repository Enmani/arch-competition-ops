"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { StoredFilterOptions, StoredOpportunityQuery } from "@arch-competition/storage";

import { serializeSearchParams } from "@/i18n/config";
import { translateMappedValue } from "@/i18n/format";
import type { DiscoverDockCopy } from "@/i18n/slices";
import {
  buildDiscoverPageSearchParams,
  collectDiscoverSearchParams,
  formatTokenLabel,
  readDiscoverPageState,
} from "@/lib/discover";
import { SaveSearchForm } from "@/components/save-search-form";

type DiscoverDockProps = {
  activeFilterCount: number;
  copy: DiscoverDockCopy;
  filterOptions: StoredFilterOptions;
  filters: StoredOpportunityQuery;
  routeBase: string;
  signedIn: boolean;
};

const isChecked = (values: readonly string[] | undefined, value: string) => values?.includes(value) ?? false;

type ChipGroupProps = {
  checked: readonly string[] | undefined;
  label: string;
  labels: Record<string, string>;
  name: string;
  values: readonly string[];
};

/** A multi-select facet: native checkboxes in a fieldset, submitted as repeated query params. */
const ChipGroup = ({ checked, label, labels, name, values }: ChipGroupProps) => (
  <fieldset className="filter-collection">
    <legend className="filter-collection-label">{label}</legend>
    <div className="filter-chip-grid">
      {values.map((value) => (
        <label className="filter-chip-option" key={value}>
          <input defaultChecked={isChecked(checked, value)} name={name} type="checkbox" value={value} />
          <span>{translateMappedValue(value, labels, formatTokenLabel(value))}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

type SelectFieldProps = {
  allLabel: string;
  className?: string;
  defaultValue: string;
  label: string;
  labels: Record<string, string>;
  name: string;
  values: readonly string[];
};

const SelectField = ({ allLabel, className, defaultValue, label, labels, name, values }: SelectFieldProps) => (
  <label className={`field-stack${className ? ` ${className}` : ""}`}>
    <span className="sr-only">{label}</span>
    <select defaultValue={defaultValue} name={name}>
      <option value="">{allLabel}</option>
      {values.map((value) => (
        <option key={value} value={value}>
          {translateMappedValue(value, labels, formatTokenLabel(value))}
        </option>
      ))}
    </select>
  </label>
);

export const DiscoverDock = ({
  activeFilterCount,
  copy,
  filterOptions,
  filters,
  routeBase,
  signedIn,
}: DiscoverDockProps) => {
  const router = useRouter();
  const { discover: text, taxonomy } = copy;
  // Open by default while filters are active; once the visitor toggles it their choice wins.
  const [toggledOpen, setToggledOpen] = useState<boolean | null>(null);
  const isOpen = toggledOpen ?? activeFilterCount > 0;
  const [isPending, startTransition] = useTransition();
  const formStateKey = serializeSearchParams(buildDiscoverPageSearchParams(filters)) || "none";

  const recencyOptions = [
    { label: text.filterOptions.anyCaptureDate, value: "" },
    { label: text.filterOptions.last7Days, value: "7" },
    { label: text.filterOptions.last30Days, value: "30" },
    { label: text.filterOptions.last90Days, value: "90" },
    { label: text.filterOptions.last365Days, value: "365" },
  ];
  const sortOptions = [
    { label: text.filterOptions.sortByDeadline, value: "deadline" },
    { label: text.filterOptions.sortByLatest, value: "latest" },
    { label: text.filterOptions.sortByContractValue, value: "highest_value" },
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
    const nextHref = `${routeBase}${serializeSearchParams(buildDiscoverPageSearchParams(nextFilters))}`;

    // push (not replace): the back button returns to the previous filter set.
    startTransition(() => {
      router.push(nextHref, { scroll: false });
    });
  };

  return (
    <section
      aria-busy={isPending}
      className={`discover-dock${isOpen ? " is-open" : ""}${isPending ? " is-pending" : ""}`}
    >
      <form
        action={routeBase}
        className="filter-form"
        key={formStateKey}
        method="GET"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit(new FormData(event.currentTarget));
        }}
      >
        <div className="discover-filter-grid discover-filter-grid-base">
          <button
            aria-controls="discover-dock-panel"
            aria-expanded={isOpen}
            aria-label={text.searchEyebrow}
            className="discover-dock-summary discover-dock-summary-icon"
            onClick={() => setToggledOpen(!isOpen)}
            title={text.searchEyebrow}
            type="button"
          >
            <span aria-hidden="true" className="discover-dock-toggle" />
          </button>

          <label className="field-stack search-field">
            <span className="sr-only">{text.filterLabels.search}</span>
            <span className="search-shell">
              <span aria-hidden="true" className="search-icon">
                <svg fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="6.75" cy="6.75" r="4.75" stroke="currentColor" strokeWidth="1.25" />
                  <path d="M10.5 10.5L14 14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
                </svg>
              </span>
              <input
                className="search-input"
                defaultValue={filters.search ?? ""}
                name="search"
                placeholder={text.placeholders.search}
                type="search"
              />
            </span>
          </label>

          <SelectField
            allLabel={text.filterOptions.allCountries}
            className="base-filter-field country-field"
            defaultValue={filters.jurisdiction ?? ""}
            label={text.filterLabels.country}
            labels={taxonomy.jurisdictions}
            name="jurisdiction"
            values={filterOptions.jurisdictions}
          />

          <label className="field-stack base-filter-field recency-field">
            <span className="sr-only">{text.filterLabels.capturedWithin}</span>
            <select defaultValue={filters.publishedWithinDays?.toString() ?? ""} name="publishedWithinDays">
              {recencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field-stack base-filter-field deadline-field">
            <span className="sr-only">{text.filterLabels.deadlineBefore}</span>
            <input
              defaultValue={filters.deadlineBefore ?? ""}
              inputMode="numeric"
              maxLength={10}
              name="deadlineBefore"
              pattern="\d{4}-\d{2}-\d{2}"
              placeholder={text.placeholders.dateIso}
              title={text.placeholders.dateIso}
              type="text"
            />
          </label>

          <div className="dock-actions">
            {isPending ? (
              <span aria-disabled="true" className="button secondary" role="link">
                {text.buttons.resetFilters}
              </span>
            ) : (
              <Link className="button secondary" href={routeBase}>
                {text.buttons.resetFilters}
              </Link>
            )}
            <button className="button primary" disabled={isPending} type="submit">
              {text.buttons.applyScreen}
            </button>
          </div>
        </div>

        <div className="discover-dock-body" id="discover-dock-panel" inert={!isOpen}>
          <div className="discover-dock-panel">
            <div className="discover-filter-grid discover-filter-grid-extra">
              <label className="field-stack">
                <span className="sr-only">{text.filterLabels.sort}</span>
                <select defaultValue={filters.sort ?? "deadline"} name="sort">
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <ChipGroup
                checked={filters.projectTypes}
                label={text.filterLabels.projectType}
                labels={taxonomy.projectTypes}
                name="projectType"
                values={filterOptions.projectTypes}
              />
              <ChipGroup
                checked={filters.buildingCategories}
                label={text.filterLabels.buildingCategory}
                labels={taxonomy.buildingCategories}
                name="buildingCategory"
                values={filterOptions.buildingCategories}
              />
              <ChipGroup
                checked={filters.designScopes}
                label={text.filterLabels.designScope}
                labels={taxonomy.designScopes}
                name="designScope"
                values={filterOptions.designScopes}
              />
              <ChipGroup
                checked={filters.projectModes}
                label={text.filterLabels.projectMode}
                labels={taxonomy.projectModes}
                name="projectMode"
                values={filterOptions.projectModes}
              />

              <SelectField
                allLabel={text.filterOptions.allProcedureTypes}
                defaultValue={filters.procedureType ?? ""}
                label={text.filterLabels.procedureType}
                labels={taxonomy.procedures}
                name="procedureType"
                values={filterOptions.procedureTypes}
              />
              <SelectField
                allLabel={text.filterOptions.allImplementationPaths}
                defaultValue={filters.implementationPath ?? ""}
                label={text.filterLabels.implementationPath}
                labels={taxonomy.implementationPaths}
                name="implementationPath"
                values={filterOptions.implementationPaths}
              />

              <label className="field-stack">
                <span className="sr-only">{text.filterLabels.deadlineAfter}</span>
                <input
                  defaultValue={filters.deadlineAfter ?? ""}
                  inputMode="numeric"
                  maxLength={10}
                  name="deadlineAfter"
                  pattern="\d{4}-\d{2}-\d{2}"
                  placeholder={text.placeholders.dateIso}
                  title={text.placeholders.dateIso}
                  type="text"
                />
              </label>

              <label className="field-stack">
                <span className="sr-only">{text.filterLabels.minValue}</span>
                <input
                  defaultValue={filters.minEstimatedValueEur?.toString() ?? ""}
                  inputMode="numeric"
                  min="0"
                  name="minEstimatedValueEur"
                  placeholder={text.filterLabels.minValue}
                  step="10000"
                  type="number"
                />
              </label>

              <label className="field-stack">
                <span className="sr-only">{text.filterLabels.maxValue}</span>
                <input
                  defaultValue={filters.maxEstimatedValueEur?.toString() ?? ""}
                  inputMode="numeric"
                  min="0"
                  name="maxEstimatedValueEur"
                  placeholder={text.filterLabels.maxValue}
                  step="10000"
                  type="number"
                />
              </label>

              <label className="field-stack">
                <span className="sr-only">{text.filterLabels.minQualificationScore}</span>
                <input
                  defaultValue={filters.minQualificationScore?.toString() ?? ""}
                  inputMode="numeric"
                  max="100"
                  min="0"
                  name="minQualificationScore"
                  placeholder={text.filterLabels.minQualificationScore}
                  step="1"
                  type="number"
                />
              </label>

              <label className="toggle-field">
                <span className="toggle-copy">
                  <input
                    defaultChecked={filters.licensedArchitectRequired === true}
                    name="licensedArchitectRequired"
                    type="checkbox"
                    value="true"
                  />
                  <span className="toggle-text">{text.filterOptions.requireLicensedArchitect}</span>
                </span>
              </label>

              <label className="toggle-field">
                <span className="toggle-copy">
                  <input
                    defaultChecked={filters.includeExpired === true}
                    name="includeExpired"
                    type="checkbox"
                    value="true"
                  />
                  <span className="toggle-text">{text.filterOptions.includeExpired}</span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </form>

      {signedIn && activeFilterCount > 0 ? <SaveSearchForm copy={copy.saved} filters={filters} /> : null}
    </section>
  );
};
