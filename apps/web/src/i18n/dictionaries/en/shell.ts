import type { AppDictionary } from "../types";

export const shell = {
  brandTitle: "Arch Competition Ops",
  captions: {
    discover: "Public design opportunities for licensed architects and practices.",
    dashboard: "Internal review, tagging, and follow-up.",
    ops: "Source, parsing, and storage status.",
    auth: "Practice account access.",
    fallback: "Public design opportunity interface.",
  },
  nav: {
    radar: "Opportunities",
    workspace: "Workspace",
    pipeline: "Ops",
  },
  utility: {
    support: "Support",
    login: "Log in",
    register: "Register",
    logout: "Log out",
  },
  search: {
    label: "Search",
    placeholder: "Authority, organizer, notice ID, title",
  },
  skipToContent: "Skip to main content",
  ariaLabels: {
    primaryNav: "Primary",
    context: "Context",
  },
  localeSwitcherLabel: "Language",
  localeNames: {
    zh: "Chinese",
    en: "English",
  },
} satisfies AppDictionary["shell"];
