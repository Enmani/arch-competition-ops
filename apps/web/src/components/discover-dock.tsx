"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { StoredFilterOptions, StoredOpportunityQuery } from "@arch-competition/storage/cloudflare";

import { serializeSearchParams } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { translateMappedValue } from "@/i18n/format";
import {
  buildDiscoverSearchParams,
  collectDiscoverSearchParams,
  discoverRecencyValues,
  discoverSortValues,
  formatTokenLabel,
  readDiscoverFilters,
} from "@/lib/discover";

type Option = {
  label: string;
  value: string;
};

type DiscoverDockProps = {
  activeFilterCount: number;
  dictionary: AppDictionary;
  filterOptions: StoredFilterOptions;
  filters: StoredOpportunityQuery;
  recencyOptions: readonly Option[];
  routeBase: string;
  sortOptions: readonly Option[];
};

const isChecked = (values: string[] | undefined, value: string) => values?.includes(value) ?? false;

export const DiscoverDock = ({
  activeFilterCount,
  dictionary,
  filterOptions,
  filters,
  recencyOptions,
  routeBase,
  sortOptions,
}: DiscoverDockProps) => {
  const router = useRouter();
  const defaultOpen = activeFilterCount > 0;
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isPending, startTransition] = useTransition();
  const formStateKey = `${routeBase}${serializeSearchParams(buildDiscoverSearchParams(filters))}`;

  useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen]);

  const handleSubmit = (formData: FormData) => {
    const rawSearchParams = new URLSearchParams();

    for (const [key, value] of formData.entries()) {
      if (typeof value !== "string") {
        continue;
      }

      const normalizedValue = value.trim();
      if (!normalizedValue) {
        continue;
      }

      rawSearchParams.append(key, normalizedValue);
    }

    const nextFilters = readDiscoverFilters(collectDiscoverSearchParams(rawSearchParams));
    const nextHref = `${routeBase}${serializeSearchParams(buildDiscoverSearchParams(nextFilters))}`;

    startTransition(() => {
      router.replace(nextHref || routeBase, { scroll: false });
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
            aria-label={dictionary.discover.searchEyebrow}
            className="discover-dock-summary discover-dock-summary-icon"
            disabled={isPending}
            onClick={() => setIsOpen((current) => !current)}
            title={dictionary.discover.searchEyebrow}
            type="button"
          >
            <span aria-hidden="true" className="discover-dock-toggle" />
          </button>

          <label className="field-stack search-field">
            <span className="sr-only">{dictionary.discover.filterLabels.search}</span>
            <span className="search-shell">
              <span aria-hidden="true" className="search-icon">
                <svg fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="6.75" cy="6.75" r="4.75" stroke="currentColor" strokeWidth="1.25" />
                  <path
                    d="M10.5 10.5L14 14"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.25"
                  />
                </svg>
              </span>
              <input
                aria-label={dictionary.discover.filterLabels.search}
                className="search-input"
                defaultValue={filters.search ?? ""}
                name="search"
                placeholder={dictionary.discover.placeholders.search}
                type="search"
              />
            </span>
          </label>

          <label className="field-stack base-filter-field country-field">
            <span className="sr-only">{dictionary.discover.filterLabels.country}</span>
            <select
              aria-label={dictionary.discover.filterLabels.country}
              defaultValue={filters.jurisdiction ?? ""}
              name="jurisdiction"
            >
              <option value="">{dictionary.discover.filterOptions.allCountries}</option>
              {filterOptions.jurisdictions.map((jurisdiction) => (
                <option key={jurisdiction} value={jurisdiction}>
                  {translateMappedValue(
                    jurisdiction,
                    dictionary.taxonomy.jurisdictions,
                    formatTokenLabel(jurisdiction),
                  )}
                </option>
              ))}
            </select>
          </label>

          <label className="field-stack base-filter-field recency-field">
            <span className="sr-only">{dictionary.discover.filterLabels.capturedWithin}</span>
            <select
              aria-label={dictionary.discover.filterLabels.capturedWithin}
              defaultValue={filters.publishedWithinDays?.toString() ?? ""}
              name="publishedWithinDays"
            >
              {recencyOptions.map((option, index) => (
                <option key={option.label} value={option.value}>
                  {option.label ?? discoverRecencyValues[index]}
                </option>
              ))}
            </select>
          </label>

          <label className="field-stack base-filter-field deadline-field">
            <span className="sr-only">{dictionary.discover.filterLabels.deadlineBefore}</span>
            <input
              aria-label={dictionary.discover.filterLabels.deadlineBefore}
              defaultValue={filters.deadlineBefore ?? ""}
              name="deadlineBefore"
              type="date"
            />
          </label>

          <div className="dock-actions">
            <Link aria-disabled={isPending} className="button secondary" href={routeBase}>
              {dictionary.discover.buttons.resetFilters}
            </Link>
            <button className="button primary" disabled={isPending} type="submit">
              {dictionary.discover.buttons.applyScreen}
            </button>
          </div>
        </div>

        <div
          aria-hidden={!isOpen}
          className="discover-dock-body"
          id="discover-dock-panel"
          inert={!isOpen}
        >
          <div className="discover-dock-panel">
            <div className="discover-filter-grid discover-filter-grid-extra">
              <label className="field-stack">
                <span className="sr-only">{dictionary.discover.filterLabels.sort}</span>
                <select
                  aria-label={dictionary.discover.filterLabels.sort}
                  defaultValue={filters.sort ?? "deadline"}
                  name="sort"
                >
                  {sortOptions.map((option, index) => (
                    <option key={option.value} value={option.value}>
                      {option.label ?? discoverSortValues[index]}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset className="filter-collection">
                <legend className="filter-collection-label">
                  {dictionary.discover.filterLabels.projectType}
                </legend>
                <div className="filter-chip-grid">
                  {filterOptions.projectTypes.map((projectType) => (
                    <label className="filter-chip-option" key={projectType}>
                      <input
                        defaultChecked={isChecked(filters.projectTypes, projectType)}
                        name="projectType"
                        type="checkbox"
                        value={projectType}
                      />
                      <span>
                        {translateMappedValue(
                          projectType,
                          dictionary.taxonomy.projectTypes,
                          formatTokenLabel(projectType),
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="filter-collection">
                <legend className="filter-collection-label">
                  {dictionary.discover.filterLabels.buildingCategory}
                </legend>
                <div className="filter-chip-grid">
                  {filterOptions.buildingCategories.map((buildingCategory) => (
                    <label className="filter-chip-option" key={buildingCategory}>
                      <input
                        defaultChecked={isChecked(filters.buildingCategories, buildingCategory)}
                        name="buildingCategory"
                        type="checkbox"
                        value={buildingCategory}
                      />
                      <span>
                        {translateMappedValue(
                          buildingCategory,
                          dictionary.taxonomy.buildingCategories,
                          formatTokenLabel(buildingCategory),
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="filter-collection">
                <legend className="filter-collection-label">
                  {dictionary.discover.filterLabels.designScope}
                </legend>
                <div className="filter-chip-grid">
                  {filterOptions.designScopes.map((designScope) => (
                    <label className="filter-chip-option" key={designScope}>
                      <input
                        defaultChecked={isChecked(filters.designScopes, designScope)}
                        name="designScope"
                        type="checkbox"
                        value={designScope}
                      />
                      <span>
                        {translateMappedValue(
                          designScope,
                          dictionary.taxonomy.designScopes,
                          formatTokenLabel(designScope),
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="filter-collection">
                <legend className="filter-collection-label">
                  {dictionary.discover.filterLabels.projectMode}
                </legend>
                <div className="filter-chip-grid">
                  {filterOptions.projectModes.map((projectMode) => (
                    <label className="filter-chip-option" key={projectMode}>
                      <input
                        defaultChecked={isChecked(filters.projectModes, projectMode)}
                        name="projectMode"
                        type="checkbox"
                        value={projectMode}
                      />
                      <span>
                        {translateMappedValue(
                          projectMode,
                          dictionary.taxonomy.projectModes,
                          formatTokenLabel(projectMode),
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="field-stack">
                <span className="sr-only">{dictionary.discover.filterLabels.deadlineAfter}</span>
                <input
                  aria-label={dictionary.discover.filterLabels.deadlineAfter}
                  defaultValue={filters.deadlineAfter ?? ""}
                  name="deadlineAfter"
                  type="date"
                />
              </label>

              <label className="field-stack">
                <span className="sr-only">{dictionary.discover.filterLabels.minValue}</span>
                <input
                  aria-label={dictionary.discover.filterLabels.minValue}
                  defaultValue={filters.minEstimatedValueEur?.toString() ?? ""}
                  inputMode="numeric"
                  min="0"
                  name="minEstimatedValueEur"
                  placeholder={dictionary.discover.filterLabels.minValue}
                  step="10000"
                  type="number"
                />
              </label>

              <label className="field-stack">
                <span className="sr-only">{dictionary.discover.filterLabels.maxValue}</span>
                <input
                  aria-label={dictionary.discover.filterLabels.maxValue}
                  defaultValue={filters.maxEstimatedValueEur?.toString() ?? ""}
                  inputMode="numeric"
                  min="0"
                  name="maxEstimatedValueEur"
                  placeholder={dictionary.discover.filterLabels.maxValue}
                  step="10000"
                  type="number"
                />
              </label>

              <label className="toggle-field">
                <span className="sr-only">{dictionary.discover.filterLabels.qualificationGate}</span>
                <span className="toggle-copy">
                  <input
                    aria-label={dictionary.discover.filterLabels.qualificationGate}
                    defaultChecked={filters.licensedArchitectRequired === true}
                    name="licensedArchitectRequired"
                    type="checkbox"
                    value="true"
                  />
                  <span className="toggle-text">
                    {dictionary.discover.filterOptions.requireLicensedArchitect}
                  </span>
                </span>
              </label>

              <label className="toggle-field">
                <span className="sr-only">{dictionary.discover.filterLabels.includeExpired}</span>
                <span className="toggle-copy">
                  <input
                    aria-label={dictionary.discover.filterLabels.includeExpired}
                    defaultChecked={filters.includeExpired === true}
                    name="includeExpired"
                    type="checkbox"
                    value="true"
                  />
                  <span className="toggle-text">
                    {dictionary.discover.filterOptions.includeExpired}
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
};
