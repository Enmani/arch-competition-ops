import type { AppDictionary } from "../types";

export const privacy = {
  title: "Privacy notice",
  description: "Which personal data this site keeps, why, for how long, and the rights you have.",
  lede: "This notice lists the personal data this site handles and why. The site keeps only what it needs to run the service; nothing is used for advertising or sold.",
  sections: [
    {
      id: "controller",
      heading: "Who is responsible for your data",
      paragraphs: [
        "{name} runs this site as an individual and is responsible for your personal data, the “data controller” in the words of the EU General Data Protection Regulation (GDPR).",
        "For any question about personal data, write to {email}.",
      ],
      items: [],
    },
    {
      id: "data",
      heading: "What data the site handles",
      paragraphs: ["Browsing projects needs no personal details. When you register, use the AI tool endpoint or pay, the site handles the following:"],
      items: [
        "Your account email.",
        "Your password, stored only as a salted hash (a fingerprint from which the password cannot be recovered), never the password itself.",
        "Sign-in sessions: valid for {sessionDays} days after sign-in and extended while you use the site. The database keeps only a hash of the session token.",
        "Your saved searches and watchlist.",
        "API keys: only a hash, the first characters, the name you gave the key, and when it was created and last used. The full key is shown once, when it is created.",
        "Usage counts: calls per month and per minute for each account. Calls made without a key are counted by IP address; the address is first hashed together with a secret random value, so the database never holds the address itself.",
        "Sign-in and registration attempts: to stop repeated password guessing, hashes of the IP address and the email are recorded and deleted after about two hours.",
        "Payment details: when you upgrade to Pro, your email is passed to Stripe to create a customer record. This site keeps only the Stripe customer id and the subscription state. Card details are handled only by Stripe and never reach this site's servers.",
        "Server logs: the hosting provider, Cloudflare, logs requests, including IP addresses, for security and operation. The site's own error logs can include an account email, but never passwords, keys or session tokens.",
      ],
    },
    {
      id: "bases",
      heading: "Why the data is handled",
      paragraphs: ["Each use rests on a legal basis recognised by the GDPR:"],
      items: [
        "Contract: to provide your account, keep your settings and provide the plan you subscribed to.",
        "Legitimate interest: to keep the site secure, prevent abuse and measure usage against each plan.",
        "Legal obligation: billing records of paid plans must be kept as tax law requires.",
      ],
    },
    {
      id: "processors",
      heading: "Who else handles the data",
      paragraphs: [
        "The site uses two providers: Cloudflare for hosting and the database, and Stripe for payments. They handle the data only on this site's instructions.",
        "There are no analytics tools and no advertising. Data is not sold and not passed to any other third party.",
      ],
      items: [],
    },
    {
      id: "transfers",
      heading: "Transfers outside the EU",
      paragraphs: [
        "Cloudflare and Stripe may process data outside the EU. Such transfers rely on the EU standard contractual clauses and, for providers certified under it, on the EU-US Data Privacy Framework.",
      ],
      items: [],
    },
    {
      id: "retention",
      heading: "How long data is kept",
      paragraphs: [],
      items: [
        "Account data: until the account is deleted.",
        "Sign-in sessions: deleted when you sign out or when they expire.",
        "Sign-in and registration attempts: deleted after about two hours.",
        "Counts of calls made without a key: one record per hashed address, holding only this month's and this minute's counts.",
        "Billing records: as long as tax law requires.",
      ],
    },
    {
      id: "rights",
      heading: "Your rights",
      paragraphs: ["You can ask at any time to:"],
      items: [
        "see the data the site holds about you.",
        "correct data that is wrong.",
        "delete your account and data.",
        "get a copy of your data in a common format.",
        "object to handling based on legitimate interest.",
        "complain to the data protection authority of your country.",
      ],
    },
    {
      id: "requests",
      heading: "How to make a request",
      paragraphs: [
        "The site has no self-service button to delete an account or export data yet. Write to {email} with your request and it will be handled within 30 days.",
        "Deleting an account removes the account, its sessions, keys, saved searches and watchlist. Billing records that the law requires to be kept are the exception.",
      ],
      items: [],
    },
    {
      id: "cookies",
      heading: "Cookies and local storage",
      paragraphs: ["The site uses only the storage needed for sign-in and for remembering preferences. There is no analytics, advertising or third-party tracking. The full list is in the cookie section of the About page."],
      items: [],
    },
    {
      id: "changes",
      heading: "Changes to this notice",
      paragraphs: ["When this notice changes, the date on this page changes too. Important changes are sent by email to registered users."],
      items: [],
    },
  ],
} satisfies AppDictionary["legal"]["privacy"];
