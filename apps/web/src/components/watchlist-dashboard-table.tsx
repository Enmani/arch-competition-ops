"use client";

import Link from "next/link";
import { useState } from "react";

import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

import WatchToggleButton from "@/components/watch-toggle-button";
import { buildLocalePath, type AppLocale } from "@/i18n/config";
import { formatDeadlineLabel, formatLocalizedDate, translateMappedValue } from "@/i18n/format";
import type { DashboardTableCopy } from "@/i18n/slices";

export type WatchlistDashboardRow = {
  opportunity: StoredOpportunityFeedItem;
  watchedAt: string;
};

type WatchlistDashboardTableProps = {
  copy: DashboardTableCopy;
  initialRows: WatchlistDashboardRow[];
  locale: AppLocale;
};

/** The dashboard page requires a session, so every toggle here is an unwatch by a signed-in user. */
const WatchlistDashboardTable = ({ copy, initialRows, locale }: WatchlistDashboardTableProps) => {
  const [rows, setRows] = useState(initialRows);

  if (rows.length === 0) {
    return (
      <div className="workspace-empty-panel">
        <span className="eyebrow">{copy.dashboard.eyebrow}</span>
        <h2>{copy.dashboard.empty.title}</h2>
        <p>{copy.dashboard.empty.body}</p>
        <Link className="button primary" href={buildLocalePath(locale, "/discover")}>
          {copy.common.backToRadar}
        </Link>
      </div>
    );
  }

  return (
    <div className="table-panel">
      <table>
        <thead>
          <tr>
            <th scope="col">{copy.dashboard.table.competition}</th>
            <th scope="col">{copy.dashboard.table.status}</th>
            <th scope="col">{copy.dashboard.table.deadline}</th>
            <th scope="col">{copy.dashboard.table.watchedAt}</th>
            <th scope="col">{copy.dashboard.table.actions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="watchlist-row" key={row.opportunity.id}>
              <td>
                <Link
                  className="inline-link"
                  href={buildLocalePath(locale, `/opportunities/${row.opportunity.slug}`)}
                >
                  {row.opportunity.title}
                </Link>
              </td>
              <td>
                {translateMappedValue(
                  row.opportunity.statusKey,
                  copy.taxonomy.statuses,
                  row.opportunity.statusLabel,
                )}
              </td>
              <td>{formatDeadlineLabel(locale, copy, row.opportunity.deadlineAt)}</td>
              <td>{formatLocalizedDate(locale, row.watchedAt) ?? row.watchedAt}</td>
              <td>
                <WatchToggleButton
                  copy={copy}
                  initialWatched
                  locale={locale}
                  onToggle={(nextWatched) => {
                    if (!nextWatched) {
                      setRows((current) => current.filter((item) => item.opportunity.id !== row.opportunity.id));
                    }
                  }}
                  opportunityId={row.opportunity.id}
                  signedIn
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default WatchlistDashboardTable;
