import { PreferencesReset } from "@/components/preferences-reset";
import type { AppDictionary } from "@/i18n/dictionaries";
import { fillTemplate } from "@/i18n/format";
import { SITE_STORAGE } from "@/lib/site-storage";

const DAY_SECONDS = 24 * 60 * 60;
const STRIPE_PRIVACY_URL = "https://stripe.com/privacy";

/** The cookie table of the About page, built from SITE_STORAGE, plus the Stripe note and the reset button. */
export const AboutCookies = ({ copy }: { copy: AppDictionary["about"]["cookies"] }) => (
  <>
    <div className="legal-table-wrap">
      <table className="legal-table legal-cookie-table">
        <caption>{copy.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{copy.columns.name}</th>
            <th scope="col">{copy.columns.purpose}</th>
            <th scope="col">{copy.columns.lifetime}</th>
          </tr>
        </thead>
        <tbody>
          {SITE_STORAGE.map((item) => (
            <tr key={item.id}>
              <th scope="row">
                <code>{item.name}</code>
                <span className="legal-cell-note">{copy.kinds[item.kind]}</span>
              </th>
              <td>
                {copy.purposes[item.id]}
                <span className="legal-cell-note">{copy.when[item.id]}</span>
                {item.flags.length > 0 ? (
                  <span className="legal-cell-note">{fillTemplate(copy.flagsLabel, { flags: item.flags.join(", ") })}</span>
                ) : null}
              </td>
              <td>
                {item.maxAgeSeconds === null
                  ? copy.lifetime.untilChanged
                  : fillTemplate(copy.lifetime.days, { days: Math.round(item.maxAgeSeconds / DAY_SECONDS) })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p>
      {copy.stripe}{" "}
      <a className="inline-link" href={STRIPE_PRIVACY_URL} rel="noreferrer" target="_blank">
        {copy.stripeLink}
      </a>
    </p>
    <PreferencesReset copy={copy.reset} />
  </>
);
