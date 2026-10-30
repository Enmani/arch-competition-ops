"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import type { StoredFilterOptions, StoredOpportunityQuery } from "@arch-competition/storage";

import { serializeSearchParams } from "@/i18n/config";
import { translateMappedValue } from "@/i18n/format";
import type { DiscoverDockCopy } from "@/i18n/slices";
import {
  buildDiscoverPageSearchParams,
  collectDiscoverSearchParams,
  countAdvancedDiscoverFilters,
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

/** A multi-select facet: native checkboxes drawn as pills, submitted as repeated query params. */
const ChipGroup = ({ checked, label, labels, name, values }: ChipGroupProps) => {
  // A facet with no known values would render an empty box; leave it out.
  if (values.length === 0) {
    return null;
  }

  return (
    <fieldset className="dock-facet">
      <legend className="dock-label">{label}</legend>
      <div className="dock-chips">
        {values.map((value) => (
          <label className="dock-chip" key={value}>
            <input defaultChecked={isChecked(checked, value)} name={name} type="checkbox" value={value} />
            <span>{translateMappedValue(value, labels, formatTokenLabel(value))}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
};

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

type DateFieldProps = { defaultValue: string | undefined; label: string; name: string };

/** ISO `YYYY-MM-DD` is what the server parses; a native date input produces exactly that. */
const DateField = ({ defaultValue, label, name }: DateFieldProps) => (
  <Field label={label}>
    <input defaultValue={defaultValue ?? ""} name={name} type="date" />
  </Field>
);

type OptionChipProps = { defaultChecked: boolean; label: string; name: string };

const OptionChip = ({ defaultChecked, label, name }: OptionChipProps) => (
  <label className="dock-chip">
    <input defaultChecked={defaultChecked} name={name} type="checkbox" value="true" />
    <span>{label}</span>
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
  const advancedCount = countAdvancedDiscoverFilters(filters);
  // Open by default while panel filters are active; once the visitor toggles it their choice wins.
  const [toggledOpen, setToggledOpen] = useState<boolean | null>(null);
  const isOpen = toggledOpen ?? advancedCount > 0;
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
        <div className="dock-bar">
          <label className="field-stack dock-search">
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

          <button
            aria-controls="discover-dock-panel"
            aria-expanded={isOpen}
            className="dock-toggle"
            onClick={() => setToggledOpen(!isOpen)}
            type="button"
          >
            <span>{text.searchEyebrow}</span>
            {advancedCount > 0 ? <span className="dock-count">{advancedCount}</span> : null}
            <span aria-hidden="true" className="discover-dock-toggle" />
          </button>

          <div className="dock-actions">
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
            <button className="button secondary" disabled={isPending} type="submit">
              {text.buttons.applyScreen}
            </button>
          </div>
        </div>

        <div className="discover-dock-body" id="discover-dock-panel" inert={!isOpen}>
          <div className="discover-dock-panel">
            <div className="dock-facets">
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
            </div>

            <div className="dock-criteria">
              <Field label={text.filterLabels.capturedWithin}>
                <select defaultValue={filters.publishedWithinDays?.toString() ?? ""} name="publishedWithinDays">
                  {recencyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <DateField
                defaultValue={filters.deadlineAfter}
                label={text.filterLabels.deadlineAfter}
                name="deadlineAfter"
              />
              <DateField
                defaultValue={filters.deadlineBefore}
                label={text.filterLabels.deadlineBefore}
                name="deadlineBefore"
              />
              <Field label={text.filterLabels.procedureType}>
                <select defaultValue={filters.procedureType ?? ""} name="procedureType">
                  <SelectOptions
                    allLabel={text.filterOptions.allProcedureTypes}
                    labels={taxonomy.procedures}
                    values={filterOptions.procedureTypes}
                  />
                </select>
              </Field>
              <Field label={text.filterLabels.implementationPath}>
                <select defaultValue={filters.implementationPath ?? ""} name="implementationPath">
                  <SelectOptions
                    allLabel={text.filterOptions.allImplementationPaths}
                    labels={taxonomy.implementationPaths}
                    values={filterOptions.implementationPaths}
                  />
                </select>
              </Field>
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
              <NumberField
                defaultValue={filters.minQualificationScore}
                label={text.filterLabels.minQualificationScore}
                max={100}
                name="minQualificationScore"
                step={1}
              />
            </div>

            <div className="dock-chips">
              <OptionChip
                defaultChecked={filters.licensedArchitectRequired === true}
                label={text.filterOptions.requireLicensedArchitect}
                name="licensedArchitectRequired"
              />
              <OptionChip
                defaultChecked={filters.includeExpired === true}
                label={text.filterOptions.includeExpired}
                name="includeExpired"
              />
            </div>
          </div>
        </div>
      </form>

      {signedIn && activeFilterCount > 0 ? <SaveSearchForm copy={copy.saved} filters={filters} /> : null}
    </section>
  );
};
