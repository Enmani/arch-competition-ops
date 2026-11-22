import Link from "next/link";

import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { countryName, type LegalPlanRow } from "@/lib/legal-content";
import { LEGAL_LINKS, type LegalLinkId } from "@/lib/legal-links";
import { OPERATOR } from "@/lib/operator";

/** Plans of the Terms page; rows come from `legalPlanRows` (MCP_PLANS and MCP_PRICING). */
type LegalPlanTableProps = {
  columns: AppDictionary["mcp"]["pricing"]["columns"];
  planLabel: string;
  rows: LegalPlanRow[];
};

export const LegalPlanTable = ({ columns, planLabel, rows }: LegalPlanTableProps) => (
  <div className="legal-table-wrap">
    <table className="legal-table">
      <thead>
        <tr>
          <th scope="col">{planLabel}</th>
          <th scope="col">{columns.month}</th>
          <th scope="col">{columns.minute}</th>
          <th scope="col">{columns.price}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr data-tier={row.tier} key={row.tier}>
            <th scope="row">{row.name}</th>
            <td>{row.month}</td>
            <td>{row.minute}</td>
            <td>{row.price}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** The operator's optional legal details; a field that is not set is left out, so nothing shows until one is. */
export const OperatorDetails = ({ labels, locale }: { labels: AppDictionary["legal"]["operator"]; locale: AppLocale }) => {
  const rows = [
    { label: labels.address, value: OPERATOR.address },
    { label: labels.taxId, value: OPERATOR.taxId },
    { label: labels.country, value: OPERATOR.country ? countryName(locale, OPERATOR.country) : null },
  ].filter((row): row is { label: string; value: string } => row.value !== null);
  if (rows.length === 0) return null;
  return (
    <dl className="legal-details">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
};

/** Links to the legal pages, from the one list in lib/legal-links.ts. */
export const LegalLinkList = ({ labels, locale }: { labels: Record<LegalLinkId, string>; locale: AppLocale }) => (
  <ul className="legal-links">
    {LEGAL_LINKS.map((link) => (
      <li key={link.id}>
        <Link className="inline-link" href={buildLocalePath(locale, link.href)}>
          {labels[link.id]}
        </Link>
      </li>
    ))}
  </ul>
);
