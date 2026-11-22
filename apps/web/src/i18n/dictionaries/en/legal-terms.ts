import type { AppDictionary } from "../types";

export const terms = {
  title: "Terms of service",
  description: "The rules for using the website and the AI tool endpoint: accounts, plans, payment, fair use and liability.",
  lede: "These terms are the rules for using this site. By creating an account or subscribing to a paid plan, you agree to them.",
  sections: [
    {
      id: "service",
      heading: "What the site offers",
      paragraphs: [
        "{name} runs this site as an individual, as a public-interest project. It gathers design procurement and competition notices published by governments and public bodies, to help architects find projects faster.",
        "The service has two parts: the website, and a read-only tool endpoint that AI assistants use to read the data (MCP, a common protocol that lets an AI assistant call outside data sources). The endpoint can only look data up; it cannot change anything.",
      ],
      items: [],
    },
    {
      id: "accounts",
      heading: "Accounts and API keys",
      paragraphs: [
        "An account is for one person. Keep your password and your API keys (the strings an AI assistant uses to prove who it is) to yourself.",
        "Each account can hold at most {maxKeys} active keys. A key is shown in full only once, when it is created. If you think a key has leaked, revoke it in your workspace and create a new one.",
      ],
      items: [],
    },
    {
      id: "plans",
      heading: "Plans and usage",
      paragraphs: [
        "Usage is the number of tool calls your AI assistant makes; each call counts once. The limits and prices of each plan are in the table below and match the pricing page.",
        "When a limit is reached, calls are refused until the next counting period starts, then work again on their own.",
      ],
      items: [],
    },
    {
      id: "billing",
      heading: "Subscription and payment",
      paragraphs: [
        "The Pro plan is a monthly or yearly subscription that renews automatically until you cancel. Payments are handled by Stripe; card details never reach this site.",
        "You can cancel at any time in the customer portal. After you cancel there are no further charges, and Pro stays active until the end of the period you have paid for.",
        "If a renewal payment fails, Pro is paused and comes back on its own once the payment goes through.",
        "Any price change is announced on this site in advance and sent by email to subscribers. Refunds are covered by the refund policy.",
      ],
      items: [],
    },
    {
      id: "fair-use",
      heading: "Fair use",
      paragraphs: ["So that everyone can use the service, please do not:"],
      items: [
        "share, lend or sell your API keys or account to anyone else.",
        "get around the usage limits with several accounts, forged requests or other means.",
        "copy the database in bulk, or resell or republish the data compiled here.",
        "send so many requests that the website or the endpoint slows down for others.",
      ],
    },
    {
      id: "accuracy",
      heading: "Accuracy of the information",
      paragraphs: [
        "The information is compiled from public sources and is for reference only. For registration, bidding and contracts, always rely on the official notice.",
        "Each record links to its official source wherever possible. Content marked on the page as prepared by AI is an automatic screening result and can be wrong.",
        "This site gives no professional or legal advice, and does not guarantee that a record is complete or current.",
      ],
      items: [],
    },
    {
      id: "assistants",
      heading: "The AI assistant you connect",
      paragraphs: [
        "The AI assistant you choose to connect (such as Claude, Cursor or VS Code) is run by its own provider. How it uses the data this site returns, and what it tells you, is between you and that provider.",
      ],
      items: [],
    },
    {
      id: "suspension",
      heading: "Suspension and termination",
      paragraphs: [
        "If an account or key is misused, or these terms are broken, we may revoke keys, suspend or close the account. Where possible we will email you first.",
        "You can stop using the site at any time. How to delete your account is in the privacy notice.",
      ],
      items: [],
    },
    {
      id: "changes",
      heading: "Changes to the service and these terms",
      paragraphs: [
        "The site keeps improving, so features may be added, changed or stopped. When these terms change, the date on this page changes too.",
        "Important changes are announced on the site in advance and sent by email to registered users.",
      ],
      items: [],
    },
    {
      id: "liability",
      heading: "Liability",
      paragraphs: [
        "As far as the law allows, we are not liable for indirect losses from using or not being able to use the site, such as a missed project or a lost bid.",
        "This does not exclude any liability that the law does not allow to be excluded, including damage caused on purpose or by gross negligence, and the rights the law gives consumers.",
      ],
      items: [],
    },
    {
      id: "source",
      heading: "Source code",
      paragraphs: ["The source code of this site is public on GitHub. The terms for using it are those stated in that repository."],
      items: [],
    },
    {
      id: "law",
      heading: "Governing law",
      paragraphs: [
        "These terms are governed by the law of {country}, and disputes go to the competent courts of {country}.",
        "If you are a consumer, the mandatory consumer protection of the country where you live still applies.",
      ],
      items: [],
    },
    {
      id: "contact",
      heading: "Contact",
      paragraphs: ["Questions about these terms: write to {email}."],
      items: [],
    },
  ],
} satisfies AppDictionary["legal"]["terms"];
