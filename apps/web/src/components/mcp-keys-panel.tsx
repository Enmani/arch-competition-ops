"use client";

import { useRef, useState, type FormEvent } from "react";

import type { McpApiKey } from "@arch-competition/core";

import { McpErrorNotice } from "@/components/mcp-error-notice";
import { McpKeyDialog } from "@/components/mcp-key-dialog";
import type { AppLocale } from "@/i18n/config";
import { fillTemplate, getIntlLocale } from "@/i18n/format";
import type { McpAccountCopy } from "@/i18n/slices";
import { useAuthDialog } from "@/lib/auth-dialog";
import { activeKeyCount, canCreateKey, isActiveKey, sortKeys, suggestKeyName } from "@/lib/mcp-account";
import { createMcpKey, listMcpKeys, revokeMcpKey, type McpFailure } from "@/lib/mcp-requests";
import { useIsClient } from "@/lib/use-is-client";

type McpKeysPanelProps = {
  connectHref: string;
  copy: McpAccountCopy;
  initialKeys: McpApiKey[];
  locale: AppLocale;
  maxActiveKeys: number;
};

/** Create, list and revoke API keys. A new key is shown once, in a dialog. */
export const McpKeysPanel = ({ connectHref, copy, initialKeys, locale, maxActiveKeys }: McpKeysPanelProps) => {
  const text = copy.account.keys;
  const openAuth = useAuthDialog();
  const isClient = useIsClient();
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState(() => suggestKeyName(initialKeys, text.defaultName));
  const [busy, setBusy] = useState<"create" | "list" | "revoke" | null>(null);
  const [failure, setFailure] = useState<McpFailure | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<McpApiKey | null>(null);
  const [notice, setNotice] = useState("");
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const confirmRef = useRef<HTMLDialogElement | null>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement | null>(null);
  const roomForKey = canCreateKey(keys, maxActiveKeys);
  const dateFormat = new Intl.DateTimeFormat(getIntlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  const formatDate = (value: string | null) => (value === null ? text.never : isClient ? dateFormat.format(new Date(value)) : "");

  const create = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (busy || !roomForKey) return;
    setBusy("create");
    setFailure(null);
    const result = await createMcpKey(name.trim());
    setBusy(null);
    if (!result.ok) {
      setFailure(result.failure);
      return;
    }
    const next = [result.data.item, ...keys];
    setKeys(next);
    setName(suggestKeyName(next, text.defaultName));
    setCreatedKey(result.data.key);
  };

  const refresh = async () => {
    setBusy("list");
    setFailure(null);
    const result = await listMcpKeys();
    setBusy(null);
    if (result.ok) setKeys(result.data.items);
    else setFailure(result.failure);
  };

  const askRevoke = (key: McpApiKey, trigger: HTMLButtonElement) => {
    confirmTriggerRef.current = trigger;
    setConfirming(key);
    requestAnimationFrame(() => confirmRef.current?.showModal());
  };

  const closeConfirm = (focus: "heading" | "trigger") => {
    confirmRef.current?.close();
    setConfirming(null);
    (focus === "trigger" ? confirmTriggerRef.current : headingRef.current)?.focus();
  };

  const revoke = async () => {
    if (!confirming || busy) return;
    setBusy("revoke");
    setFailure(null);
    const result = await revokeMcpKey(confirming.id);
    setBusy(null);
    if (result.ok) {
      setKeys((current) => current.map((key) => (key.id === result.data.id ? result.data : key)));
      setNotice(fillTemplate(text.revokedNotice, { name: result.data.name }));
      closeConfirm("heading");
    } else {
      setFailure(result.failure);
      closeConfirm("trigger");
    }
  };

  const limitId = "mcp-keys-limit";

  return (
    <section aria-labelledby="mcp-keys-title" className="mcp-block mcp-keys" id="mcp-keys">
      <div className="mcp-block-head">
        <h3 id="mcp-keys-title" ref={headingRef} tabIndex={-1}>
          {text.title}
        </h3>
        <span className="mcp-meta">
          {fillTemplate(text.count, { active: activeKeyCount(keys), max: maxActiveKeys })}
        </span>
      </div>

      <form className="mcp-create" onSubmit={(event) => void create(event)}>
        <label htmlFor="mcp-key-name">{text.nameLabel}</label>
        <input
          aria-describedby={roomForKey ? undefined : limitId}
          aria-invalid={failure?.step === "fixInput" || undefined}
          disabled={!roomForKey}
          id="mcp-key-name"
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        <button
          aria-busy={busy === "create"}
          className="button primary"
          disabled={!roomForKey || busy !== null}
          ref={createButtonRef}
          type="submit"
        >
          {busy === "create" ? text.creating : text.create}
        </button>
        {roomForKey ? null : (
          <p className="mcp-note" id={limitId}>
            {fillTemplate(text.limitReached, { max: maxActiveKeys })}
          </p>
        )}
      </form>

      {failure ? (
        <McpErrorNotice
          actions={{
            refreshList: { label: copy.account.actions.refreshList, run: () => void refresh() },
            reload: { label: copy.account.actions.reload, run: () => window.location.reload() },
            retry: { label: copy.account.actions.retry, run: () => void refresh() },
            retryLater: { label: copy.account.actions.retry, run: () => void refresh() },
            ...(openAuth ? { signIn: { label: copy.account.actions.signIn, run: () => openAuth("login") } } : {}),
          }}
          copy={copy.account}
          failure={failure}
        />
      ) : null}

      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {keys.length === 0 ? (
        <p className="mcp-empty">{text.empty}</p>
      ) : (
        <ul aria-busy={busy === "list"} aria-label={text.listLabel} className="mcp-key-list">
          {sortKeys(keys).map((key) => {
            const active = isActiveKey(key);
            return (
              <li className={`mcp-key-row${active ? "" : " is-revoked"}`} key={key.id}>
                <span className="mcp-key-name">{key.name}</span>
                <code className="mcp-key-prefix">{key.prefix}</code>
                <dl className="mcp-key-dates">
                  <div>
                    <dt>{text.columns.created}</dt>
                    <dd>{formatDate(key.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>{text.columns.lastUsed}</dt>
                    <dd>{formatDate(key.lastUsedAt)}</dd>
                  </div>
                </dl>
                <span className={`mcp-key-status${active ? " is-active" : ""}`}>{active ? text.active : text.revoked}</span>
                {active ? (
                  <button
                    aria-label={`${text.revoke} ${key.name}`}
                    className="button secondary"
                    disabled={busy !== null}
                    onClick={(event) => askRevoke(key, event.currentTarget)}
                    type="button"
                  >
                    {text.revoke}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <dialog
        aria-labelledby="mcp-revoke-title"
        className="mcp-dialog"
        onCancel={(event) => {
          event.preventDefault();
          closeConfirm("trigger");
        }}
        ref={confirmRef}
      >
        {confirming ? (
          <div className="mcp-dialog-card">
            <h2 id="mcp-revoke-title">{fillTemplate(text.confirmTitle, { name: confirming.name })}</h2>
            <p>{text.confirmBody}</p>
            <div className="mcp-dialog-actions">
              <button
                aria-busy={busy === "revoke"}
                className="button secondary is-danger"
                disabled={busy !== null}
                onClick={() => void revoke()}
                type="button"
              >
                {busy === "revoke" ? text.revoking : text.confirm}
              </button>
              <button autoFocus className="button secondary" onClick={() => closeConfirm("trigger")} type="button">
                {text.cancel}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>

      {createdKey ? (
        <McpKeyDialog
          closeLabel={copy.closeLabel}
          connectHref={connectHref}
          copy={{ copy: copy.copy, created: copy.account.created }}
          keyValue={createdKey}
          onClose={() => {
            setCreatedKey(null);
            (createButtonRef.current?.disabled ? headingRef.current : createButtonRef.current)?.focus();
          }}
        />
      ) : null}
    </section>
  );
};
