"use client";

import { useState } from "react";

import { clearSavedPreferences } from "@/lib/site-storage";
import { applyThemeChoice } from "@/lib/theme";

type PreferencesResetProps = {
  copy: { button: string; done: string; hint: string };
};

/** Clears the language cookie and the saved theme; the sign-in session cookie is HttpOnly and kept. */
export const PreferencesReset = ({ copy }: PreferencesResetProps) => {
  const [done, setDone] = useState(false);

  return (
    <div className="preferences-reset">
      <button
        className="button secondary"
        onClick={() => {
          clearSavedPreferences(() => applyThemeChoice("system"));
          setDone(true);
        }}
        type="button"
      >
        {copy.button}
      </button>
      <p className="preferences-reset-hint">{copy.hint}</p>
      <p aria-live="polite" className="preferences-reset-status" role="status">
        {done ? copy.done : ""}
      </p>
    </div>
  );
};
