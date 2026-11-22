/**
 * Install snippets for the MCP endpoint, one per client. Pure functions so the formats are unit
 * tested; each one follows the client's own documentation (links in docs/structures, MCP entry):
 *
 * - Claude Code: `claude mcp add --transport http <name> <url> [--header "..."]`
 * - Cursor: `~/.cursor/mcp.json` `mcpServers` entry with `url`/`headers`; the install link is
 *   `cursor://anysphere.cursor-deeplink/mcp/install?name=..&config=<base64(JSON entry)>`
 * - VS Code: profile `mcp.json` `servers` entry with `type: "http"`; the install link is
 *   `vscode:mcp/install?<encodeURIComponent(JSON with name)>`
 *
 * Install links are custom-scheme URLs handed to the local app, never https URLs, so a key in
 * one does not travel to a web server. They are built only when clicked (see connect-clients).
 */
export const MCP_SERVER_NAME = "arch-competition";
export const MCP_DEFAULT_ORIGIN = "https://arch-competition.com";

export const MCP_CLIENTS = ["claude", "claudeCode", "cursor", "vscode", "other"] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

export const mcpEndpoint = (origin: string) => `${origin.replace(/\/+$/, "")}/mcp`;

const headersFor = (key: string | null) => (key ? { Authorization: `Bearer ${key}` } : undefined);

export const claudeCodeCommand = (url: string, key: string | null) =>
  `claude mcp add --transport http --scope user ${MCP_SERVER_NAME} ${url}` +
  (key ? ` --header "Authorization: Bearer ${key}"` : "");

const cursorEntry = (url: string, key: string | null) => ({ url, ...(key ? { headers: headersFor(key) } : {}) });

export const cursorConfig = (url: string, key: string | null) =>
  JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: cursorEntry(url, key) } }, null, 2);

/** Cursor's docs: JSON.stringify the entry, base64 it; the base64 is URL-encoded so `+` survives. */
export const cursorInstallLink = (url: string, key: string | null) => {
  const config = btoa(JSON.stringify(cursorEntry(url, key)));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(config)}`;
};

const vscodeEntry = (url: string, key: string | null) => ({
  type: "http",
  url,
  ...(key ? { headers: headersFor(key) } : {}),
});

export const vscodeConfig = (url: string, key: string | null) =>
  JSON.stringify({ servers: { [MCP_SERVER_NAME]: vscodeEntry(url, key) } }, null, 2);

export const vscodeInstallLink = (url: string, key: string | null) =>
  `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: MCP_SERVER_NAME, ...vscodeEntry(url, key) }))}`;

/** The shape most other clients read (`mcpServers` with a Streamable HTTP entry). */
export const genericConfig = (url: string, key: string | null) =>
  JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: vscodeEntry(url, key) } }, null, 2);

const KEY_PREFIX = /^(arch_mcp_[A-Za-z0-9_-]{12})\./;

/** What a key looks like on screen when hidden: its public prefix, then dots. */
export const maskKey = (key: string) => {
  const prefix = KEY_PREFIX.exec(key)?.[1];
  return prefix ? `${prefix}.••••••••` : "••••••••";
};

/** A pasted value is used only if it has the shape of a key; whitespace from copying is dropped. */
export const normalizePastedKey = (value: string, pattern: RegExp) => {
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : null;
};

/** Replaces every occurrence of the key in a snippet, for the hidden view of a command. */
export const hideKeyIn = (text: string, key: string | null) => (key ? text.split(key).join(maskKey(key)) : text);
