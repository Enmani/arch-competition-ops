"use client";

import { useSearchParams } from "next/navigation";

import { DISCOVER_FILTER_FORM_ID } from "@/lib/discover";

type TopbarSearchProps = {
  copy: { label: string; placeholder: string };
};

/**
 * The discover page's search box, living in the top bar. It is a member of the filter form by id
 * (the `form` attribute), so Enter submits that form and its value travels with the filters.
 * It is keyed by the applied search, so Reset or the back button put the field back in sync.
 */
export const TopbarSearch = ({ copy }: TopbarSearchProps) => {
  const applied = useSearchParams().get("search") ?? "";

  return (
    <label className="field-stack topbar-search" key={applied}>
      <span className="sr-only">{copy.label}</span>
      <span className="search-shell">
        <span aria-hidden="true" className="search-icon">
          <svg fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
            <circle cx="6.75" cy="6.75" r="4.75" stroke="currentColor" strokeWidth="1.25" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
          </svg>
        </span>
        <input
          className="search-input"
          defaultValue={applied}
          form={DISCOVER_FILTER_FORM_ID}
          name="search"
          placeholder={copy.placeholder}
          type="search"
        />
      </span>
    </label>
  );
};
