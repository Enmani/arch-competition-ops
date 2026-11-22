import type { AppDictionary } from "../types";

export const about = {
  title: "About this site",
  description: "What Arch Competition Ops is, where the data comes from, how to get in touch, and the cookies the site uses.",
  lede: "A public-interest website that helps architects find public design projects.",
  sections: [
    {
      id: "project",
      heading: "What this is",
      paragraphs: [
        "Arch Competition Ops is a public-interest project by {name}. It helps licensed architects and design teams find design procurement and competition notices published by governments and public bodies, faster.",
        "The site updates itself twice a day. Each record links to its official source wherever possible, so you can check the original.",
        "The information is compiled from public sources and is for reference only. For registration and bidding, always rely on the official notice.",
      ],
      items: [],
    },
    {
      id: "data",
      heading: "Where the data comes from",
      paragraphs: [
        "Most notices come from the official procurement portals of national governments, with a few from other public bodies and aggregator sites. When an aggregator disagrees with the official source, the official source wins and the difference is noted in the record.",
        "Anything the notice does not state stays empty or shows as “unknown”; nothing is guessed.",
      ],
      items: [],
    },
    {
      id: "reading",
      heading: "How to read a record",
      paragraphs: ["A record holds two kinds of content, shown apart on the page:"],
      items: [
        "Official fields: deadline, value, issuing body, eligibility and so on, taken from the notice, with a link to the original.",
        "AI screening results: a project summary and reasons to look at it, written by AI from the notice, and its view of whether the project is worth an architect's attention. They help you scan quickly and can be wrong.",
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      paragraphs: ["If you find a mistake, want to suggest a data source or have any other idea, please write. The source code is public on GitHub."],
      items: [],
    },
    {
      id: "legal",
      heading: "Legal",
      paragraphs: ["The rules for using the site, how personal data is handled and the refund rules are on these pages."],
      items: [],
    },
    {
      id: "cookies",
      heading: "Cookies and local storage",
      paragraphs: [
        "The site keeps only what the table below lists in your browser: the cookie needed for sign-in, and your language and theme preferences. There is no analytics, advertising or third-party tracking, so no cookie consent is needed.",
      ],
      items: [],
    },
  ],
  cookies: {
    caption: "What the site keeps in your browser",
    columns: { name: "Name", purpose: "Purpose", lifetime: "Kept for" },
    kinds: { cookie: "Cookie", localStorage: "Local storage" },
    purposes: {
      session: "Keeps you signed in.",
      locale: "Remembers the language you used last, so an address without a language (such as the home page) opens in it.",
      theme: "Remembers whether you chose the light or dark theme.",
    },
    when: {
      session: "Set only when you sign in; removed when you sign out.",
      locale: "Set each time you open a page in another language.",
      theme: "Saved when you choose light or dark; removed when you switch back to “Match system”.",
    },
    lifetime: { days: "{days} days", untilChanged: "Until you change the setting or clear site data" },
    flagsLabel: "Attributes: {flags}",
    stripe: "The payment and subscription pages are hosted by Stripe, which sets its own cookies on them.",
    stripeLink: "Stripe privacy notice",
    reset: {
      button: "Reset saved preferences",
      hint: "Clears the language cookie and the theme setting. You stay signed in.",
      done: "Done. The theme now follows your device; the site will remember the language again when you open the next page.",
    },
  },
} satisfies AppDictionary["about"];
