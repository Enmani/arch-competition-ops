"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { StoredOpportunityFeedItem } from "@arch-competition/storage/cloudflare";

import WatchToggleButton from "@/components/watch-toggle-button";
import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { formatDeadlineLabel, formatLocalizedDate, translateMappedValue } from "@/i18n/format";

export type WatchlistDashboardRow = {
  opportunity: StoredOpportunityFeedItem;
  watchedAt: string;
};

type WatchlistDashboardTableProps = {
  dictionary: AppDictionary;
  initialRows: WatchlistDashboardRow[];
  locale: AppLocale;
  workspaceWritesEnabled: boolean;
};

const WatchlistDashboardTable = ({
  dictionary,
  initialRows,
  locale,
  workspaceWritesEnabled,
}: WatchlistDashboardTableProps) => {
  const [rows, setRows] = useState(initialRows);
  const discoverPath = buildLocalePath(locale, "/discover");

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  if (rows.length === 0) {
    return (
      <div className="workspace-empty-panel">
        <span className="eyebrow">{dictionary.dashboard.eyebrow}</span>
        <h2>{dictionary.dashboard.empty.title}</h2>
        <p>{workspaceWritesEnabled ? dictionary.dashboard.empty.body : dictionary.workspace.readOnly}</p>
        <Link className="button primary" href={discoverPath}>
          {dictionary.common.backToRadar}
        </Link>
      </div>
    );
  }

  return (
    <div className="table-panel">
      <table>
        <thead>
          <tr>
            <th>{dictionary.dashboard.table.competition}</th>
            <th>{dictionary.dashboard.table.status}</th>
            <th>{dictionary.dashboard.table.deadline}</th>
            <th>{dictionary.dashboard.table.watchedAt}</th>
            <th>{dictionary.dashboard.table.actions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const detailPath = buildLocalePath(locale, `/opportunities/${row.opportunity.slug}`);
            const watchedAtLabel =
              formatLocalizedDate(
                locale,
                row.watchedAt,
                locale === "zh"
                  ? { year: "numeric", month: "numeric", day: "numeric" }
                  : { day: "2-digit", month: "short", year: "numeric" },
              ) ?? row.watchedAt;

            return (
              <tr key={row.opportunity.id}>
                <td>
                  <Link className="inline-link" href={detailPath}>
                    {row.opportunity.title}
                  </Link>
                </td>
                <td>
                  {translateMappedValue(
                    row.opportunity.statusKey,
                    dictionary.taxonomy.statuses,
                    row.opportunity.statusLabel,
                  )}
                </td>
                <td>{formatDeadlineLabel(locale, dictionary, row.opportunity.deadlineAt)}</td>
                <td>{watchedAtLabel}</td>
                <td>
                  <WatchToggleButton
                    initialWatched
                    onToggle={(nextWatched) => {
                      if (!nextWatched) {
                        setRows((currentRows) =>
                          currentRows.filter((item) => item.opportunity.id !== row.opportunity.id),
                        );
                      }
                    }}
                    opportunityId={row.opportunity.id}
                    workspaceDictionary={dictionary.workspace}
                    workspaceWritesEnabled={workspaceWritesEnabled}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default WatchlistDashboardTable;
