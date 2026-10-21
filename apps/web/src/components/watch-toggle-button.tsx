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
};

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
}: WatchToggleButtonProps) => {
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
        <Link className="button secondary watch-toggle-button" href={loginHref}>
          {dictionary.signInToWatch}
        </Link>
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

  return (
    <div className={`watch-toggle${showStatus ? " has-status" : ""}`}>
      <button
        className={`button secondary watch-toggle-button${isWatched ? " is-active" : ""}`}
        disabled={isSaving}
        onClick={() => void handleClick()}
        type="button"
      >
        {isSaving ? dictionary.saving : isWatched ? dictionary.unwatch : dictionary.watch}
      </button>
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
