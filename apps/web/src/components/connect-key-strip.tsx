"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";

import { MCP_KEY_PATTERN, type McpApiKey } from "@arch-competition/core";

import { McpErrorNotice } from "@/components/mcp-error-notice";
import { McpKeyDialog } from "@/components/mcp-key-dialog";
import { fillTemplate } from "@/i18n/format";
import type { ConnectCopy } from "@/i18n/slices";
import { useAuthDialog } from "@/lib/auth-dialog";
import { canCreateKey, suggestKeyName } from "@/lib/mcp-account";
import { maskKey, normalizePastedKey } from "@/lib/mcp-connect";
import { createMcpKey, type McpFailure } from "@/lib/mcp-requests";

type ConnectKeyStripProps = {
  accountHref: string;
  copy: ConnectCopy;
  /** Null for anonymous visitors. */
  initialKeys: McpApiKey[] | null;
  keyValue: string | null;
  maxActiveKeys: number;
  onKeyChange: (key: string | null) => void;
  onRevealChange: (revealed: boolean) => void;
  registerHref: string;
  revealed: boolean;
};

/**
 * Which key the commands below use. Anonymous by default; a signed-in visitor can create one in
 * place, anyone can paste one they kept. The key stays in memory for this visit only.
 */
export const ConnectKeyStrip = ({
  accountHref, copy, initialKeys, keyValue, maxActiveKeys, onKeyChange, onRevealChange, registerHref, revealed,
}: ConnectKeyStripProps) => {
  const openAuth = useAuthDialog();
  const pasteId = useId();
  const [keys, setKeys] = useState(initialKeys ?? []);
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<McpFailure | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [pasteInvalid, setPasteInvalid] = useState(false);
  const focusAfterDialogRef = useRef<HTMLButtonElement | null>(null);
  const text = copy.connect.key;
  const signedIn = initialKeys !== null;
  const roomForKey = canCreateKey(keys, maxActiveKeys);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setFailure(null);
    const result = await createMcpKey(suggestKeyName(keys, copy.defaultKeyName));
    setCreating(false);
    if (!result.ok) {
      setFailure(result.failure);
      return;
    }
    setKeys((current) => [result.data.item, ...current]);
    onKeyChange(result.data.key);
    setCreatedKey(result.data.key);
  };

  const paste = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("key") as HTMLInputElement;
    const key = normalizePastedKey(input.value, MCP_KEY_PATTERN);
    setPasteInvalid(key === null);
    if (key) {
      input.value = "";
      onKeyChange(key);
    }
  };

  const closeDialog = () => {
    setCreatedKey(null);
    focusAfterDialogRef.current?.focus();
  };

  const signIn = () => (openAuth ? openAuth("login") : window.location.assign(registerHref));

  if (keyValue) {
    return (
      <div className="mcp-key-strip" aria-live="polite">
        <span className="mcp-key-inuse">
          {fillTemplate(text.inUse, { key: revealed ? keyValue : maskKey(keyValue) })}
        </span>
        <span className="mcp-key-actions">
          <button
            aria-pressed={revealed}
            className="button secondary"
            onClick={() => onRevealChange(!revealed)}
            ref={focusAfterDialogRef}
            type="button"
          >
            {revealed ? text.hide : text.show}
          </button>
          <button className="button secondary" onClick={() => onKeyChange(null)} type="button">
            {text.remove}
          </button>
        </span>
        {createdKey ? (
          <McpKeyDialog closeLabel={copy.closeLabel} copy={copy} keyValue={createdKey} onClose={closeDialog} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="mcp-key-strip">
      <span className="mcp-key-lead">{signedIn ? text.signedIn : text.anonymous}</span>
      <span className="mcp-key-actions">
        {signedIn ? (
          roomForKey ? (
            <button
              aria-busy={creating}
              className="button primary"
              disabled={creating}
              onClick={() => void create()}
              type="button"
            >
              {creating ? text.creating : text.create}
            </button>
          ) : (
            <span className="mcp-note">
              {fillTemplate(text.full, { count: maxActiveKeys })}{" "}
              <Link className="inline-link" href={accountHref}>
                {text.manage}
              </Link>
            </span>
          )
        ) : (
          <Link
            className="button secondary"
            href={registerHref}
            onClick={(event) => {
              if (!openAuth || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              openAuth("register");
            }}
          >
            {text.getKey}
          </Link>
        )}
      </span>
      <form className="mcp-paste" onSubmit={paste}>
        <label htmlFor={pasteId}>{text.pasteLabel}</label>
        <input
          aria-describedby={pasteInvalid ? `${pasteId}-error` : undefined}
          aria-invalid={pasteInvalid || undefined}
          autoComplete="off"
          id={pasteId}
          name="key"
          onChange={() => setPasteInvalid(false)}
          placeholder={text.pastePlaceholder}
          spellCheck={false}
          type="password"
        />
        <button className="button secondary" type="submit">
          {text.use}
        </button>
        {pasteInvalid ? (
          <span className="mcp-field-error" id={`${pasteId}-error`} role="alert">
            {text.pasteInvalid}
          </span>
        ) : null}
      </form>
      {failure ? (
        <McpErrorNotice
          actions={{
            reload: { label: copy.actions.reload, run: () => window.location.reload() },
            retry: { label: copy.actions.retry, run: () => void create() },
            retryLater: { label: copy.actions.retry, run: () => void create() },
            revokeOne: { label: text.manage, run: () => window.location.assign(accountHref) },
            signIn: { label: copy.actions.signIn, run: signIn },
          }}
          copy={copy}
          failure={failure}
        />
      ) : null}
    </div>
  );
};
