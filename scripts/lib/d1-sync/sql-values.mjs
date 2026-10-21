// SQL literal formatting for the D1 sync export.
// Values come from a local SQLite file and are treated as untrusted: every literal is escaped
// here, and identifiers never pass through this module (they come from table-specs.mjs).

export class SqlValueError extends Error {
  constructor(message) {
    super(message);
    this.name = "SqlValueError";
  }
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Quote a table/column name. Only plain identifiers are accepted, everything else throws. */
export function quoteIdentifier(name) {
  if (typeof name !== "string" || !IDENTIFIER_PATTERN.test(name)) {
    throw new SqlValueError(`Unsafe SQL identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

function describe({ table, key, column }) {
  return `${table}[${String(key)}].${column}`;
}

/**
 * Format one JS value as a SQLite literal.
 * `context` ({ table, key, column }) is only used to make error messages actionable.
 */
export function formatSqlValue(value, context) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SqlValueError(`Non-finite number (${value}) at ${describe(context)}`);
    }
    return String(value);
  }
  if (typeof value === "string") {
    if (value.includes("\u0000")) {
      throw new SqlValueError(`NUL character in text value at ${describe(context)}`);
    }
    return `'${value.replaceAll("'", "''")}'`;
  }
  if (value instanceof Uint8Array) {
    return `X'${Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex")}'`;
  }
  throw new SqlValueError(`Unsupported value type ${typeof value} at ${describe(context)}`);
}
