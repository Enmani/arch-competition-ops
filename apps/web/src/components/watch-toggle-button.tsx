"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

import type { AppLocale } from "@/i18n/config";
import type { WatchToggleCopy } from "@/i18n/slices";
import { describeApiFailure, sendJson, type ApiFailure } from "@/lib/api-client";
import { buildLoginRedirect } from "@/lib/return-path";

type WatchToggleButtonProps = {
  copy: WatchToggleCopy;
  initialWatched: boolean;
  locale: AppLocale;
  onToggle?: (isWatched: boolean) => void;
  opportunityId: string;
  showStatus?: boolean;
  signedIn: boolean;
  /** "icon" draws a square + / check mark (for a corner of an image); the text goes to the accessible name. */
  variant?: "icon" | "text";
};

const WatchGlyph = ({ watched }: { watched: boolean }) => (
  <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
    {watched ? <path d="M3 8.5l3.2 3.2L13 4.8" /> : <path d="M8 2v12M2 8h12" />}
  </svg>
);

/**
 * Optimistic watch/unwatch control.
 *
 * The in-flight flag lives in a ref (not only in state) so two clicks in the same frame cannot
 * both pass the guard. Callers key the component by opportunity id, so it never has to
 * reconcile a changing id with a pending request. Anonymous visitors get a sign-in link
 * instead of a dead disabled button.
 */
const WatchToggleButton = ({
  copy,
  initialWatched,
  locale,
  onToggle,
  opportunityId,
  showStatus = false,
  signedIn,
  variant = "text",
}: WatchToggleButtonProps) => {
  const isIcon = variant === "icon";
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [isWatched, setIsWatched] = useState(initialWatched);
  const [isSaving, setIsSaving] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const inFlightRef = useRef(false);
  const dictionary = copy.workspace.watchlist;
  const loginHref = buildLoginRedirect(locale, search ? `${pathname}?${search}` : pathname);

  if (!signedIn) {
    return (
      <div className="watch-toggle">
        {isIcon ? (
          <Link
            aria-label={dictionary.signInToWatch}
            className="watch-toggle-icon"
            href={loginHref}
            title={dictionary.signInToWatch}
          >
            <WatchGlyph watched={false} />
          </Link>
        ) : (
          <Link className="button secondary watch-toggle-button" href={loginHref}>
            {dictionary.signInToWatch}
          </Link>
        )}
      </div>
    );
  }

  const handleClick = async () => {
    if (inFlightRef.current) {
      return;
    }

    const nextWatched = !isWatched;
    inFlightRef.current = true;
    setIsSaving(true);
    setFailure(null);
    setIsWatched(nextWatched);
    onToggle?.(nextWatched);

    const result = await sendJson("/api/watchlists", nextWatched ? "POST" : "DELETE", { opportunityId });

    inFlightRef.current = false;
    setIsSaving(false);
    if (!result.ok) {
      setIsWatched(!nextWatched);
      onToggle?.(!nextWatched);
      setFailure(result.failure);
    }
  };

  const label = isSaving ? dictionary.saving : isWatched ? dictionary.unwatch : dictionary.watch;

  return (
    <div className={`watch-toggle${showStatus ? " has-status" : ""}`}>
      {isIcon ? (
        <button
          aria-label={label}
          aria-pressed={isWatched}
          className={`watch-toggle-icon${isWatched ? " is-active" : ""}`}
          disabled={isSaving}
          onClick={() => void handleClick()}
          title={label}
          type="button"
        >
          <WatchGlyph watched={isWatched} />
        </button>
      ) : (
        <button
          className={`button secondary watch-toggle-button${isWatched ? " is-active" : ""}`}
          disabled={isSaving}
          onClick={() => void handleClick()}
          type="button"
        >
          {label}
        </button>
      )}
      <span aria-live="polite" className="watch-toggle-state" role="status">
        {showStatus && isWatched && !failure ? dictionary.watched : null}
      </span>
      {failure ? (
        <span className="watch-toggle-error" role="alert">
          {failure.kind === "generic" ? dictionary.errors.update : describeApiFailure(copy.common.apiErrors, failure)}{" "}
          {failure.kind === "unauthenticated" ? (
            <Link className="inline-link" href={loginHref}>
              {copy.common.signIn}
            </Link>
          ) : null}
        </span>
      ) : null}
    </div>
  );
};

export default WatchToggleButton;
