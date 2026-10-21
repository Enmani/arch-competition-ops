"use client";

import { useId, useRef, useState } from "react";

import { SAVED_SEARCH_NAME_MAX_LENGTH } from "@arch-competition/core";
import type { StoredOpportunityQuery } from "@arch-competition/storage";

import type { SavedSearchCopy } from "@/i18n/slices";
import { describeApiFailure, sendJson } from "@/lib/api-client";
import { buildDiscoverPageSearchParams } from "@/lib/discover";

type SaveSearchFormProps = {
  copy: SavedSearchCopy;
  filters: StoredOpportunityQuery;
};

/** Saves the current filter set to the signed-in user's private workspace. */
export const SaveSearchForm = ({ copy, filters }: SaveSearchFormProps) => {
  const nameId = useId();
  const inFlightRef = useRef(false);
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "saved"; text: string } | null>(null);
  const text = copy.savedSearches;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setIsSaving(true);
    setMessage(null);
    const result = await sendJson("/api/saved-searches", "POST", {
      name: trimmed,
      // Paging is URL state, not part of what a saved search means.
      searchParams: buildDiscoverPageSearchParams(filters),
    });
    inFlightRef.current = false;
    setIsSaving(false);

    if (result.ok) {
      setName("");
      setMessage({ kind: "saved", text: text.saved });
    } else {
      setMessage({
        kind: "error",
        text:
          result.failure.kind === "generic" || result.failure.kind === "invalid_request"
            ? text.errors.save
            : describeApiFailure(copy.apiErrors, result.failure),
      });
    }
  };

  return (
    <form className="save-search-form" onSubmit={(event) => void handleSubmit(event)}>
      <label className="sr-only" htmlFor={nameId}>
        {text.nameLabel}
      </label>
      <input
        id={nameId}
        maxLength={SAVED_SEARCH_NAME_MAX_LENGTH}
        onChange={(event) => setName(event.target.value)}
        placeholder={text.placeholder}
        required
        type="text"
        value={name}
      />
      <button className="button secondary" disabled={isSaving || name.trim() === ""} type="submit">
        {isSaving ? text.saving : text.save}
      </button>
      <span aria-live="polite" className={`save-search-message${message?.kind === "error" ? " is-error" : ""}`} role="status">
        {message?.text ?? null}
      </span>
    </form>
  );
};
