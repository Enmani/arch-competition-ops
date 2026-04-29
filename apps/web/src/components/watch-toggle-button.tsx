"use client";

import { useEffect, useRef, useState } from "react";

import type { AppDictionary } from "@/i18n/dictionaries";

type WatchToggleButtonProps = {
  initialWatched: boolean;
  onToggle?: (isWatched: boolean) => void;
  opportunityId: string;
  showStatus?: boolean;
  workspaceDictionary: AppDictionary["workspace"];
  workspaceWritesEnabled: boolean;
};

const WatchToggleButton = ({
  initialWatched,
  onToggle,
  opportunityId,
  showStatus = false,
  workspaceDictionary,
  workspaceWritesEnabled,
}: WatchToggleButtonProps) => {
  const [isWatched, setIsWatched] = useState(initialWatched);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const isMutatingRef = useRef(false);
  const opportunityIdRef = useRef(opportunityId);
  const requestSequenceRef = useRef(0);
  const dictionary = workspaceDictionary.watchlist;
  const stateText =
    errorMessage ?? (isWatched ? dictionary.watched : !workspaceWritesEnabled ? dictionary.readOnly : null);

  useEffect(() => {
    opportunityIdRef.current = opportunityId;
    requestSequenceRef.current += 1;
    isMutatingRef.current = false;
    setIsWatched(initialWatched);
    setErrorMessage(null);
    setIsMutating(false);
  }, [initialWatched, opportunityId]);

  const finishRequest = (requestSequence: number, targetOpportunityId: string) => {
    if (
      requestSequence !== requestSequenceRef.current ||
      targetOpportunityId !== opportunityIdRef.current
    ) {
      return false;
    }

    isMutatingRef.current = false;
    setIsMutating(false);
    return true;
  };

  const handleClick = () => {
    if (!workspaceWritesEnabled || isMutatingRef.current) {
      return;
    }

    const nextWatched = !isWatched;
    const targetOpportunityId = opportunityId;
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    isMutatingRef.current = true;
    setIsMutating(true);
    setErrorMessage(null);
    void (async () => {
      try {
        const response = await fetch("/api/watchlists", {
          method: nextWatched ? "POST" : "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ opportunityId: targetOpportunityId }),
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || dictionary.errors.update);
        }

        if (
          requestSequence !== requestSequenceRef.current ||
          targetOpportunityId !== opportunityIdRef.current
        ) {
          return;
        }

        setIsWatched(nextWatched);
        onToggle?.(nextWatched);
      } catch {
        if (
          requestSequence !== requestSequenceRef.current ||
          targetOpportunityId !== opportunityIdRef.current
        ) {
          return;
        }

        setErrorMessage(dictionary.errors.update);
      } finally {
        finishRequest(requestSequence, targetOpportunityId);
      }
    })();
  };

  return (
    <div className={`watch-toggle${showStatus ? " has-status" : ""}`}>
      <button
        aria-pressed={isWatched}
        className={`button secondary watch-toggle-button${isWatched ? " is-active" : ""}`}
        disabled={!workspaceWritesEnabled || isMutating}
        onClick={handleClick}
        title={!workspaceWritesEnabled ? dictionary.readOnly : undefined}
        type="button"
      >
        {isMutating ? dictionary.saving : isWatched ? dictionary.unwatch : dictionary.watch}
      </button>
      {showStatus && stateText ? <span className="watch-toggle-state">{stateText}</span> : null}
    </div>
  );
};

export default WatchToggleButton;
