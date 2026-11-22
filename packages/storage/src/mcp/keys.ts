import { timingSafeEqual } from "node:crypto";

import { MCP_KEY_PATTERN, MCP_MAX_ACTIVE_KEYS, type McpApiKey } from "@arch-competition/core";

import { bytesToBase64Url, hexToBytes, randomBytes, sha256Hex } from "../auth/encoding";
import type { StorageContext } from "../context";
import { readRow, readRows } from "../driver/sql";

type KeyRow = {
  id: string;
  prefix: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};
const columns = "id, prefix, name, created_at, last_used_at, revoked_at";
const keyMetadata = (row: KeyRow): McpApiKey => ({
  id: row.id,
  prefix: row.prefix,
  name: row.name,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
});

export const createMcpKey = async (context: StorageContext, userId: string, name: string) => {
  const id = bytesToBase64Url(randomBytes(9));
  const prefix = `arch_mcp_${id}`;
  const key = `${prefix}.${bytesToBase64Url(randomBytes(32))}`;
  const hash = await sha256Hex(key);
  const row = await readRow<KeyRow>(context.writer, `
    INSERT INTO api_keys (id, user_id, token_hash, prefix, name, created_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM api_keys WHERE user_id = ? AND revoked_at IS NULL) < ?
    RETURNING ${columns}
  `, [id, userId, hash, prefix, name, context.clock.now().toISOString(), userId, MCP_MAX_ACTIVE_KEYS]);
  return row ? { item: keyMetadata(row), key } : null;
};

export const listMcpKeys = async (context: StorageContext, userId: string) =>
  (await readRows<KeyRow>(context.writer, `
    SELECT ${columns} FROM api_keys WHERE user_id = ?
    ORDER BY revoked_at IS NULL DESC, created_at DESC, id DESC LIMIT 50
  `, [userId])).map(keyMetadata);

export const revokeMcpKey = async (context: StorageContext, userId: string, id: string) => {
  const row = await readRow<KeyRow>(context.writer, `
    UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ?)
    WHERE user_id = ? AND id = ? RETURNING ${columns}
  `, [context.clock.now().toISOString(), userId, id]);
  return row ? keyMetadata(row) : null;
};

export type McpKeyPrincipal = { id: string; userId: string };

export const authenticateMcpKey = async (context: StorageContext, key: string): Promise<McpKeyPrincipal | null> => {
  const id = MCP_KEY_PATTERN.exec(key)?.[1];
  if (!id) return null;
  const hash = await sha256Hex(key);
  const row = await readRow<{ user_id: string; token_hash: string; revoked_at: string | null }>(
    context.writer, "SELECT user_id, token_hash, revoked_at FROM api_keys WHERE id = ?", [id],
  );
  const matches = timingSafeEqual(hexToBytes(hash), hexToBytes(row?.token_hash ?? "0".repeat(64)));
  return matches && row && row.revoked_at === null ? { id, userId: row.user_id } : null;
};
