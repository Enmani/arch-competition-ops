import type { AppDictionary } from "../types";

export const refund = {
  title: "Refund policy",
  description: "How to cancel a Pro subscription, when a refund is possible and how long it takes.",
  lede: "This policy covers monthly and yearly subscriptions to the Pro plan.",
  sections: [
    {
      id: "cancel",
      heading: "Cancel at any time",
      paragraphs: [
        "You can cancel at any time from the customer portal in your workspace. After you cancel there are no further charges; Pro stays active until the end of the period you have paid for, then the account returns to the Free key plan.",
      ],
      items: [],
    },
    {
      id: "first-payment",
      heading: "Full refund within 14 days of the first payment",
      paragraphs: [
        "Within 14 days of the first payment for a plan (monthly or yearly), you can ask for a full refund. Write to {email} from the email address of your account and say which subscription it is.",
      ],
      items: [],
    },
    {
      id: "renewals",
      heading: "Renewals",
      paragraphs: ["Renewal payments are not refunded, except when:"],
      items: ["the law requires a refund.", "the service was unavailable for a substantial part of that billing period."],
    },
    {
      id: "how",
      heading: "How a refund is paid",
      paragraphs: ["Refunds go back through Stripe to the payment method you used, usually within 5 to 10 working days depending on your bank."],
      items: [],
    },
    {
      id: "plan",
      heading: "Your plan after a refund",
      paragraphs: [],
      items: [
        "Full refund of the latest billing period: Pro ends straight away and the account returns to the Free key plan.",
        "Partial refund: Pro stays active until the end of that period.",
      ],
    },
    {
      id: "withdrawal",
      heading: "Right of withdrawal for EU consumers",
      paragraphs: ["If you are a consumer in the EU, your statutory 14-day right of withdrawal is not affected by this policy."],
      items: [],
    },
    {
      id: "contact",
      heading: "Contact",
      paragraphs: ["Questions about payments or refunds: write to {email}."],
      items: [],
    },
  ],
} satisfies AppDictionary["legal"]["refund"];
