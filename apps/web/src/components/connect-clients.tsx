"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import { CodeSnippet } from "@/components/mcp-snippet";
import type { ConnectCopy } from "@/i18n/slices";
import {
  MCP_CLIENTS, claudeCodeCommand, cursorConfig, cursorInstallLink, genericConfig, hideKeyIn, vscodeConfig,
  vscodeInstallLink, type McpClient,
} from "@/lib/mcp-connect";

type ConnectClientsProps = {
  copy: Pick<ConnectCopy, "connect" | "copy">;
  endpoint: string;
  /** A key held in memory for this visit, or null for the anonymous configuration. */
  keyValue: string | null;
  revealed: boolean;
};

/** One tab per client; each shows the client's documented install path and a manual fallback. */
export const ConnectClients = ({ copy, endpoint, keyValue, revealed }: ConnectClientsProps) => {
  const [active, setActive] = useState<McpClient>("claude");
  const tabRefs = useRef<Partial<Record<McpClient, HTMLButtonElement | null>>>({});
  const text = copy.connect;

  const snippet = (label: string, build: (url: string, key: string | null) => string) => {
    const value = build(endpoint, keyValue);
    return (
      <CodeSnippet
        copy={copy.copy}
        display={revealed ? value : hideKeyIn(value, keyValue)}
        label={label}
        value={() => build(endpoint, keyValue)}
      />
    );
  };

  // Built on click so a key is not left in an href; custom schemes go to the local app only.
  const install = (build: (url: string, key: string | null) => string) => () =>
    window.location.assign(build(endpoint, keyValue));

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = MCP_CLIENTS.indexOf(active);
    const moves: Record<string, number> = {
      ArrowLeft: (index - 1 + MCP_CLIENTS.length) % MCP_CLIENTS.length,
      ArrowRight: (index + 1) % MCP_CLIENTS.length,
      End: MCP_CLIENTS.length - 1,
      Home: 0,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = MCP_CLIENTS[moves[event.key]];
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const panel = () => {
    switch (active) {
      case "claude":
        return (
          <>
            <ol className="mcp-steps">
              {text.claude.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="mcp-note">{text.claude.note}</p>
          </>
        );
      case "claudeCode":
        return (
          <>
            <p>{text.claudeCode.lead}</p>
            {snippet(text.clients.claudeCode, claudeCodeCommand)}
            <p className="mcp-note">{text.claudeCode.check}</p>
          </>
        );
      case "cursor":
        return (
          <>
            <button className="button primary mcp-install" onClick={install(cursorInstallLink)} type="button">
              {text.cursor.install}
            </button>
            <p>{text.cursor.manual}</p>
            {snippet(text.clients.cursor, cursorConfig)}
          </>
        );
      case "vscode":
        return (
          <>
            <button className="button primary mcp-install" onClick={install(vscodeInstallLink)} type="button">
              {text.vscode.install}
            </button>
            <p>{text.vscode.manual}</p>
            {snippet(text.clients.vscode, vscodeConfig)}
          </>
        );
      default:
        return (
          <>
            <dl className="mcp-facts">
              <div>
                <dt>{text.other.transport}</dt>
                <dd>{text.other.transportValue}</dd>
              </div>
              <div>
                <dt>{text.other.auth}</dt>
                <dd>{keyValue ? text.other.authKey : text.other.authNone}</dd>
              </div>
            </dl>
            <p>{text.other.config}</p>
            {snippet(text.clients.other, genericConfig)}
          </>
        );
    }
  };

  return (
    <section aria-label={text.clientsLabel} className="mcp-clients">
      <div aria-label={text.clientsLabel} className="mcp-tabs" role="tablist">
        {MCP_CLIENTS.map((client) => (
          <button
            aria-controls={`mcp-panel-${client}`}
            aria-selected={active === client}
            className="mcp-tab"
            id={`mcp-tab-${client}`}
            key={client}
            onClick={() => setActive(client)}
            onKeyDown={onTabKey}
            ref={(element) => {
              tabRefs.current[client] = element;
            }}
            role="tab"
            tabIndex={active === client ? 0 : -1}
            type="button"
          >
            {text.clients[client]}
          </button>
        ))}
      </div>
      <div aria-labelledby={`mcp-tab-${active}`} className="mcp-panel" id={`mcp-panel-${active}`} role="tabpanel" tabIndex={0}>
        {panel()}
      </div>
    </section>
  );
};
