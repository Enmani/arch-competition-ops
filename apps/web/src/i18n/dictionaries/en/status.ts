import type { AppDictionary } from "../types";

export const status = {
  notFound: {
    eyebrow: "404",
    title: "Page not found",
    body: "The link may have expired, or the opportunity was removed.",
    action: "Back to opportunities",
  },
  error: {
    eyebrow: "Something went wrong",
    title: "This page could not be shown",
    body: "The problem is on our side, not yours. Try once more, and come back later if it keeps failing.",
    retry: "Try again",
    action: "Back to opportunities",
    reference: "Reference",
  },
  forbidden: {
    eyebrow: "403",
    title: "You do not have access to this page",
    body: "The operations pages are for administrators only. Ask an administrator for access, or sign in with an administrator account.",
    action: "Back to opportunities",
  },
  loading: {
    label: "Loading",
  },
} satisfies AppDictionary["status"];
