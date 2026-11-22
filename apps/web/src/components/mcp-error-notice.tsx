"use client";

import { fillTemplate } from "@/i18n/format";
import type { AppDictionary } from "@/i18n/dictionaries";
import type { McpNextStep } from "@/lib/mcp-account";

type Account = AppDictionary["mcp"]["account"];

export type McpFailureState = { retryAfterSeconds: number | null; step: McpNextStep };

type McpErrorNoticeProps = {
  /** The button offered for a step, when the caller can perform it. */
  actions?: Partial<Record<McpNextStep, { label: string; run: () => void }>>;
  copy: Pick<Account, "errors">;
  failure: McpFailureState;
};

/** A failed request: what happened and the one next step, announced as it appears. */
export const McpErrorNotice = ({ actions, copy, failure }: McpErrorNoticeProps) => {
  const message =
    failure.step === "retryLater" && failure.retryAfterSeconds !== null
      ? fillTemplate(copy.errors.retryAfter, { seconds: failure.retryAfterSeconds })
      : copy.errors[failure.step];
  const action = actions?.[failure.step];

  return (
    <div className="mcp-notice is-error" role="alert">
      <p>{message}</p>
      {action ? (
        <button className="button secondary" onClick={action.run} type="button">
          {action.label}
        </button>
      ) : null}
    </div>
  );
};
