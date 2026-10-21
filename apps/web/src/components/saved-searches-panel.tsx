"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type { StoredSavedSearch } from "@arch-competition/storage";

import { buildLocalePath, serializeSearchParams, type AppLocale } from "@/i18n/config";
import type { SavedSearchCopy } from "@/i18n/slices";
import { describeApiFailure, sendJson } from "@/lib/api-client";
import { buildDiscoverPageSearchParams } from "@/lib/discover";

type SavedSearchesPanelProps = {
  copy: SavedSearchCopy;
  initialItems: StoredSavedSearch[];
  locale: AppLocale;
};

/** The signed-in user's saved filters: open one on the discover page, or delete it. */
export const SavedSearchesPanel = ({ copy, initialItems, locale }: SavedSearchesPanelProps) => {
  const [items, setItems] = useState(initialItems);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const text = copy.savedSearches;

  const remove = async (id: number) => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setRemovingId(id);
    setError(null);
    const result = await sendJson("/api/saved-searches", "DELETE", { id });
    inFlightRef.current = false;
    setRemovingId(null);

    if (result.ok) {
      setItems((current) => current.filter((item) => item.id !== id));
    } else {
      setError(
        result.failure.kind === "generic" ? text.errors.remove : describeApiFailure(copy.apiErrors, result.failure),
      );
    }
  };

  return (
    <div className="saved-searches">
      {error ? (
        <p className="saved-searches-error" role="alert">
          {error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="saved-searches-empty">{text.empty}</p>
      ) : (
        <ul aria-label={text.listLabel} className="saved-searches-list">
          {items.map((item) => (
            <li className="saved-searches-item" key={item.id}>
              <span className="saved-searches-name">{item.name}</span>
              <Link
                className="button secondary"
                href={`${buildLocalePath(locale, "/discover")}${serializeSearchParams(buildDiscoverPageSearchParams(item.filters))}`}
              >
                {text.open}
              </Link>
              <button
                className="button secondary"
                aria-busy={removingId === item.id}
                disabled={removingId !== null}
                onClick={() => void remove(item.id)}
                type="button"
              >
                {text.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
