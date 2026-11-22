"use client";

import { useEffect, useRef } from "react";

import { CopyButton } from "@/components/mcp-snippet";
import type { AppDictionary } from "@/i18n/dictionaries";

type McpKeyDialogProps = {
  closeLabel: string;
  /** Opens the setup steps in a new tab, so this dialog (and the key) stays put. */
  connectHref?: string;
  copy: { copy: AppDictionary["mcp"]["copy"]; created: AppDictionary["mcp"]["account"]["created"] };
  keyValue: string;
  onClose: () => void;
};

/**
 * The only time a new key is visible. The plaintext lives in this component's props and the
 * clipboard; it is never stored, logged or put in a URL. Closing returns focus to the caller,
 * which owns the element that opened it.
 */
export const McpKeyDialog = ({ closeLabel, connectHref, copy, keyValue, onClose }: McpKeyDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  // Close first: focus cannot move out while the modal still makes the page inert.
  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  return (
    <dialog
      aria-describedby="mcp-key-dialog-body"
      aria-labelledby="mcp-key-dialog-title"
      className="mcp-dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      ref={dialogRef}
    >
      <div className="mcp-dialog-card">
        <button aria-label={closeLabel} className="auth-dialog-close" onClick={close} title={closeLabel} type="button">
          <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
        <h2 id="mcp-key-dialog-title">{copy.created.title}</h2>
        <p id="mcp-key-dialog-body">{copy.created.body}</p>
        <output className="mcp-key-value">{keyValue}</output>
        <div className="mcp-dialog-actions">
          <CopyButton copy={copy.copy} label={copy.created.title} primary value={keyValue} />
          <button className="button secondary" onClick={close} type="button">
            {copy.created.done}
          </button>
        </div>
        {connectHref ? (
          <a className="inline-link" href={connectHref} rel="noopener" target="_blank">
            {copy.created.connect}
          </a>
        ) : null}
      </div>
    </dialog>
  );
};
