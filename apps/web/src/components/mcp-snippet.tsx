"use client";

import { useEffect, useRef, useState } from "react";

import type { AppDictionary } from "@/i18n/dictionaries";

type CopyCopy = AppDictionary["mcp"]["copy"];

type CopyButtonProps = {
  copy: CopyCopy;
  /** Names what is copied for screen readers, e.g. "MCP address". */
  label?: string;
  primary?: boolean;
  /** Read at click time, so a key never has to sit in the DOM to be copied. */
  value: string | (() => string);
};

/** Copy to the clipboard with a visible and an announced result. */
export const CopyButton = ({ copy, label, primary = false, value }: CopyButtonProps) => {
  const [state, setState] = useState<"copied" | "failed" | "idle">("idle");
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const run = async () => {
    window.clearTimeout(timerRef.current);
    try {
      await navigator.clipboard.writeText(typeof value === "function" ? value() : value);
      setState("copied");
    } catch {
      setState("failed");
    }
    timerRef.current = window.setTimeout(() => setState("idle"), 2400);
  };

  return (
    <span className="copy-control">
      <button
        aria-label={label ? `${copy.copy} ${label}` : undefined}
        className={`button ${primary ? "primary" : "secondary"} copy-button`}
        onClick={() => void run()}
        type="button"
      >
        {state === "copied" ? copy.copied : copy.copy}
      </button>
      <span aria-live="polite" className={state === "failed" ? "copy-failed" : "sr-only"}>
        {state === "copied" ? copy.copied : state === "failed" ? copy.failed : ""}
      </span>
    </span>
  );
};

type CodeSnippetProps = {
  copy: CopyCopy;
  /** What is shown; may hide a key that `value` contains. */
  display: string;
  label: string;
  value: string | (() => string);
};

/** A command or config block with its copy button. */
export const CodeSnippet = ({ copy, display, label, value }: CodeSnippetProps) => (
  <div className="mcp-snippet">
    <pre aria-label={label} className="mcp-code" tabIndex={0}>
      <code>{display}</code>
    </pre>
    <CopyButton copy={copy} label={label} value={value} />
  </div>
);
