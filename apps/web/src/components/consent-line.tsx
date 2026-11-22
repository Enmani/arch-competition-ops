import Link from "next/link";
import { Fragment } from "react";

import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";

type ConsentLineProps = {
  copy: AppDictionary["legal"]["consent"];
  locale: AppLocale;
  /** Called when a link is followed, so a dialog can close before the page changes. */
  onFollow?: () => void;
};

/**
 * "By creating an account you agree to the Terms and the Privacy notice", with both names as
 * links in the same tab. No checkbox: registering is the agreement, which keeps sign-up short.
 */
export const ConsentLine = ({ copy, locale, onFollow }: ConsentLineProps) => {
  const link = (path: string, label: string) => (
    <Link className="auth-link" href={buildLocalePath(locale, path)} onClick={onFollow}>
      {label}
    </Link>
  );
  const links = { privacy: link("/privacy", copy.privacy), terms: link("/terms", copy.terms) };
  // Split the sentence around {terms} and {privacy} so each language keeps its own word order.
  const parts = copy.text.split(/(\{terms\}|\{privacy\})/);

  return (
    <p className="auth-consent">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part === "{terms}" ? links.terms : part === "{privacy}" ? links.privacy : part}
        </Fragment>
      ))}
    </p>
  );
};
