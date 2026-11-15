"use client";

import { useEffect, useState, type ReactNode } from "react";

import { THEME_ORDER, applyThemeChoice, readThemeChoice, type ThemeChoice } from "@/lib/theme";

type ThemeToggleProps = {
  copy: { dark: string; label: string; light: string; system: string };
};

// 16px glyphs in the topbar's line weight: a half-filled disc (follow the system), a sun, a moon.
const GLYPHS: Record<ThemeChoice, ReactNode> = {
  system: (
    <>
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.15" />
      <path d="M8 2.75a5.25 5.25 0 0 1 0 10.5z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="8" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.15" />
      <path
        d="M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.15"
      />
    </>
  ),
  dark: (
    <path
      d="M12.9 9.6A5.3 5.3 0 0 1 6.4 3.1a5.3 5.3 0 1 0 6.5 6.5z"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.15"
    />
  ),
};

/**
 * One button that cycles system, light, dark. The accessible name states the current choice; the
 * choice is kept in localStorage and applied as data-theme on <html> (lib/theme.ts, tokens.css).
 */
export const ThemeToggle = ({ copy }: ThemeToggleProps) => {
  // The server cannot know the saved choice, so it renders "system" and the real one is read after mount.
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => setChoice(readThemeChoice()), []);

  const cycle = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(choice) + 1) % THEME_ORDER.length];
    applyThemeChoice(next);
    setChoice(next);
  };
  const name = `${copy.label}: ${copy[choice]}`;

  return (
    <button aria-label={name} className="locale-trigger theme-toggle" onClick={cycle} title={name} type="button">
      <span aria-hidden="true" className="locale-globe">
        <svg fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
          {GLYPHS[choice]}
        </svg>
      </span>
    </button>
  );
};
