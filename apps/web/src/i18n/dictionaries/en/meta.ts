import type { AppDictionary } from "../types";

export const meta = {
  siteName: "Arch Competition Ops",
  ogLocale: "en_GB",
  description: "Public design opportunities from official sources for licensed architects and practices.",
  pages: {
    discover: {
      title: "Design opportunities",
      description:
        "Filter public design opportunities from official sources by country, deadline, value and qualification requirements.",
    },
    dashboard: {
      title: "Workspace",
      description: "Review watched opportunities and saved searches.",
    },
    ops: {
      title: "Operations",
      description: "Source health, parser failures and the manual review queue.",
    },
    support: {
      title: "Support the project",
      description: "How the project works and where support goes first.",
    },
    login: {
      title: "Log in",
      description: "Log in to watch opportunities and save searches.",
    },
    register: {
      title: "Register",
      description: "Create an account to keep a watchlist and saved searches.",
    },
  },
  detailDescription: "{facts}. Source: official notice and traceable links.",
  detailFallbackTitle: "Opportunity details",
} satisfies AppDictionary["meta"];
