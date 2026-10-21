import type { AppDictionary } from "../types";

export const dashboard = {
  eyebrow: "Workspace",
  title: "Practice workspace",
  description: "Review watched opportunities and continue qualification, teaming, and delivery screening.",
  table: {
    competition: "Competition",
    status: "Status",
    deadline: "Deadline",
    watchedAt: "Watched at",
    actions: "Actions",
  },
  empty: {
    title: "No watched opportunities yet.",
    body: "Watch opportunities from discover or detail to build a follow-up list here.",
  },
} satisfies AppDictionary["dashboard"];
