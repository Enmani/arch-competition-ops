import type { AppDictionary } from "../types";
import { privacy } from "./legal-privacy";
import { refund } from "./legal-refund";
import { terms } from "./legal-terms";

export const legal = {
  updated: "Last updated: {date}",
  toc: "On this page",
  links: {
    label: "Legal",
    about: "About",
    terms: "Terms",
    privacy: "Privacy",
    refund: "Refund",
    cookies: "Cookies",
  },
  footer: {
    label: "Site information",
    copyright: "© {year} {name}",
  },
  operator: {
    address: "Address",
    taxId: "Tax id",
    country: "Country",
  },
  garante: "In Italy, this is the Italian data protection authority (Garante per la protezione dei dati personali).",
  planColumn: "Plan",
  cookiesLink: "See the cookie list",
  consent: {
    text: "By creating an account you agree to the {terms} and the {privacy}.",
    terms: "Terms",
    privacy: "Privacy notice",
  },
  terms,
  privacy,
  refund,
} satisfies AppDictionary["legal"];
