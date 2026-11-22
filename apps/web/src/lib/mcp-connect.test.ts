import assert from "node:assert/strict";
import test from "node:test";

import { MCP_KEY_PATTERN } from "@arch-competition/core";

import {
  claudeCodeCommand, cursorConfig, cursorInstallLink, genericConfig, hideKeyIn, maskKey, mcpEndpoint,
  normalizePastedKey, vscodeConfig, vscodeInstallLink,
} from "./mcp-connect";

const url = "https://arch-competition.com/mcp";
const key = `arch_mcp_AbCdEfGhIjKl.${"x".repeat(43)}`;

test("the endpoint is the origin plus /mcp, without a doubled slash", () => {
  assert.equal(mcpEndpoint("https://arch-competition.com"), url);
  assert.equal(mcpEndpoint("http://localhost:3400/"), "http://localhost:3400/mcp");
});

test("Claude Code: the documented http transport, with the key as a bearer header only when given", () => {
  assert.equal(claudeCodeCommand(url, null), `claude mcp add --transport http --scope user arch-competition ${url}`);
  assert.equal(
    claudeCodeCommand(url, key),
    `claude mcp add --transport http --scope user arch-competition ${url} --header "Authorization: Bearer ${key}"`,
  );
});

test("Cursor: mcpServers entry with url and optional headers", () => {
  assert.deepEqual(JSON.parse(cursorConfig(url, null)), { mcpServers: { "arch-competition": { url } } });
  assert.deepEqual(JSON.parse(cursorConfig(url, key)), {
    mcpServers: { "arch-competition": { headers: { Authorization: `Bearer ${key}` }, url } },
  });
});

test("Cursor install link carries the base64 entry and decodes back to it", () => {
  const link = new URL(cursorInstallLink(url, key));
  assert.equal(`${link.protocol}//${link.host}${link.pathname}`, "cursor://anysphere.cursor-deeplink/mcp/install");
  assert.equal(link.searchParams.get("name"), "arch-competition");
  const config = JSON.parse(atob(link.searchParams.get("config") ?? ""));
  assert.deepEqual(config, { headers: { Authorization: `Bearer ${key}` }, url });
});

test("VS Code: servers entry of type http; the install link holds the named entry, URL-encoded", () => {
  assert.deepEqual(JSON.parse(vscodeConfig(url, null)), { servers: { "arch-competition": { type: "http", url } } });
  const link = vscodeInstallLink(url, null);
  assert.ok(link.startsWith("vscode:mcp/install?"));
  assert.deepEqual(JSON.parse(decodeURIComponent(link.slice("vscode:mcp/install?".length))), {
    name: "arch-competition", type: "http", url,
  });
});

test("generic config uses mcpServers with a typed http entry", () => {
  assert.deepEqual(JSON.parse(genericConfig(url, key)), {
    mcpServers: { "arch-competition": { headers: { Authorization: `Bearer ${key}` }, type: "http", url } },
  });
});

test("a hidden key keeps only its public prefix", () => {
  assert.equal(maskKey(key), "arch_mcp_AbCdEfGhIjKl.••••••••");
  assert.equal(maskKey("not a key"), "••••••••");
  const hidden = hideKeyIn(claudeCodeCommand(url, key), key);
  assert.ok(!hidden.includes(key));
  assert.ok(hidden.includes("Bearer arch_mcp_AbCdEfGhIjKl.••••••••"));
  assert.equal(hideKeyIn("no key here", null), "no key here");
});

test("a pasted key is accepted only in the key format, surrounding whitespace dropped", () => {
  assert.equal(normalizePastedKey(`  ${key}\n`, MCP_KEY_PATTERN), key);
  assert.equal(normalizePastedKey("arch_mcp_short.abc", MCP_KEY_PATTERN), null);
  assert.equal(normalizePastedKey("", MCP_KEY_PATTERN), null);
});
