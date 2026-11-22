/**
 * Theme choice: "system" (no attribute, the OS setting decides), "light" or "dark". The choice
 * lives in localStorage and as data-theme on <html>; cookies are avoided on purpose, because
 * reading one in the root layout would make every page dynamic.
 */
export type ThemeChoice = "dark" | "light" | "system";

export const THEME_STORAGE_KEY = "theme";

/**
 * Fired on window after every change, with the choice as `detail`, so the toggle button follows a
 * reset made elsewhere even when storage is blocked.
 */
export const THEME_CHANGE_EVENT = "arch-theme-change";

export const THEME_ORDER: readonly ThemeChoice[] = ["system", "light", "dark"];

export const parseThemeChoice = (value: string | null | undefined): ThemeChoice =>
  value === "light" || value === "dark" ? value : "system";

/** Runs in <head> before first paint; keep it tiny, dependency-free and failure-proof. */
export const themeBootScript = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export const readThemeChoice = (): ThemeChoice => {
  try {
    return parseThemeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
};

export const applyThemeChoice = (choice: ThemeChoice) => {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
  try {
    if (choice === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // Private mode or blocked storage: the choice still applies to this page view.
  }
  window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_CHANGE_EVENT, { detail: choice }));
};
