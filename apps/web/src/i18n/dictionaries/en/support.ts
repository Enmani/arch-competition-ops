import type { AppDictionary } from "../types";

export const support = {
  heroEyebrow: "Support the project",
  heroTitle: "Organize project opportunities architects and practices can pursue",
  heroIntro:
    "Arch Competition Ops tracks public notices and authority pages, then turns them into traceable opportunity intelligence for architecture firms. Support goes first into source coverage, qualification review, and team workflows.",
  heroActions: {
    primary: "See support options",
    secondary: "Browse the radar",
  },
  contact: {
    eyebrow: "Contact and repo",
    title: "Support, collaboration, or feedback can start here",
    body:
      "If you want to discuss support, suggest improvements, or review current progress first, send an email or open the public repository.",
    items: [
      {
        label: "Email",
        value: "fangxiaoyandi@gmail.com",
        href: "mailto:fangxiaoyandi@gmail.com",
      },
      {
        label: "Repository",
        value: "github.com/Enmani/arch-competition-ops",
        href: "https://github.com/Enmani/arch-competition-ops",
      },
    ],
  },
  principles: {
    eyebrow: "Position",
    title: "Core rules stay fixed",
    items: [
      {
        label: "Official-source first",
        value: "Official notices and authority pages stay above aggregators and reposts.",
      },
      {
        label: "Procurement-first",
        value: "The product is organized around screening and bid decisions.",
      },
      {
        label: "Multilingual support",
        value: "Product copy is structured for multilingual expansion for cross-border teams.",
      },
    ],
  },
  rationale: {
    eyebrow: "Why support",
    title: "Support goes here first",
    body:
      "Support goes into source coverage, qualification review, evidence handling, and the workflow after discovery.",
    points: [
      "Faster path from official notice to usable intelligence.",
      "Qualification gates earlier in the screening stage.",
    ],
  },
  tracks: {
    eyebrow: "Ways to support",
    title: "Three ways to support",
    intro:
      "Support is arranged through project-based partnerships for now.",
    items: [
      {
        eyebrow: "Studio pilots",
        title: "Studio pilot backing",
        summary:
          "For practices, business-development leads, and bid teams that want early influence on the product. Priority goes to screening, alerts, and qualification briefs.",
        points: [
          "Good fit for teams that want input before the workflow hardens.",
          "Runs as a defined pilot.",
        ],
        note: "Each pilot is scoped case by case.",
      },
      {
        eyebrow: "Authority distribution",
        title: "Organizer and institution distribution backing",
        summary:
          "For organizers, public institutions, and agency-side partners that need qualified reach after publication.",
        points: [
          "Built around professional reach.",
          "Funds verified distribution and reporting.",
        ],
        note: "Handled as a distribution partnership.",
      },
      {
        eyebrow: "Research and data",
        title: "Research and data partnerships",
        summary:
          "For schools, research institutions, foundations, and data partners.",
        points: [
          "Prioritizes source expansion and multilingual normalization.",
          "Keeps the public intelligence layer traceable and reusable.",
        ],
        note: "Partnership shape depends on research scope and data boundaries.",
      },
    ],
  },
  roadmap: {
    eyebrow: "Next phase",
    title: "Support funds these capabilities next",
    items: [
      {
        label: "Saved searches",
        value: "Turn recurring filters into persistent team radar.",
      },
      {
        label: "Qualification briefs",
        value: "Compress eligibility and risk into actionable pursuit summaries.",
      },
      {
        label: "Verified distribution",
        value: "Give authority-side partners a professional post-publication reach layer.",
      },
    ],
  },
  closing: {
    eyebrow: "Current status",
    title: "Support is handled project by project",
    body:
      "Public contact and payment options will be added later. For now, support is scoped around the partnership itself.",
    disclaimer:
      "Scope and materials are agreed case by case.",
    primary: "Back to support options",
    secondary: "Review the live opportunity surface",
  },
} satisfies AppDictionary["support"];
