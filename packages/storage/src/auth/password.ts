import { scrypt, timingSafeEqual } from "node:crypto";

import { base64UrlToBytes, bytesToBase64Url, hexToBytes, randomBytes } from "./encoding";

/**
 * Password hashing, shared by every runtime (Node dev server and Cloudflare Workers with
 * `nodejs_compat`) through `node:crypto` scrypt.
 *
 * Stored format (self-describing, PHC style):
 *   $scrypt$ln=14,r=8,p=5$<salt base64url>$<hash base64url>
 * Salt and hash are raw bytes encoded once, as base64url. Parameters live in the string, so
 * raising them later only requires changing SCRYPT_PARAMS: old hashes keep verifying with
 * their own parameters and are upgraded on the next successful login.
 *
 * Parameters follow the OWASP recommendation N=2^14, r=8, p=5. Their CPU cost on Cloudflare
 * Workers has NOT been measured yet; measure it before enabling sign-ups in production
 * (see docs/structures/2026-10-21-storage-auth-api-architecture.md).
 */
export const SCRYPT_PARAMS = { keyLength: 32, ln: 14, p: 5, r: 8, saltBytes: 16 } as const;

// Defensive bounds for parameters read back from the database.
const MAX_LN = 16;
const MAX_R = 16;
const MAX_P = 16;
const MIN_SALT_BYTES = 8;
const MAX_SALT_BYTES = 64;
const MIN_HASH_BYTES = 16;
const MAX_HASH_BYTES = 128;

type ScryptSettings = { hash: Uint8Array; ln: number; p: number; r: number; salt: Uint8Array };

const derive = (password: string, salt: Uint8Array, keyLength: number, ln: number, r: number, p: number) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const cost = 2 ** ln;
    scrypt(
      password,
      salt,
      keyLength,
      { N: cost, maxmem: 128 * cost * r + 128 * r * p + 4 * 1024 * 1024, p, r },
      (error, derivedKey) => (error ? reject(error) : resolve(new Uint8Array(derivedKey))),
    );
  });

export const hashPassword = async (password: string) => {
  const salt = randomBytes(SCRYPT_PARAMS.saltBytes);
  const hash = await derive(
    password,
    salt,
    SCRYPT_PARAMS.keyLength,
    SCRYPT_PARAMS.ln,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
  );
  return `$scrypt$ln=${SCRYPT_PARAMS.ln},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
};

const withinBounds = ({ hash, ln, p, r, salt }: ScryptSettings) =>
  ln >= 4 &&
  ln <= MAX_LN &&
  r >= 1 &&
  r <= MAX_R &&
  p >= 1 &&
  p <= MAX_P &&
  salt.length >= MIN_SALT_BYTES &&
  salt.length <= MAX_SALT_BYTES &&
  hash.length >= MIN_HASH_BYTES &&
  hash.length <= MAX_HASH_BYTES;

const parseNumber = (value: string | undefined) => (value && /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN);

/** Current format: `$scrypt$ln=14,r=8,p=5$<salt>$<hash>`. Returns null when it does not apply. */
const parseCurrentFormat = (stored: string): ScryptSettings | null => {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "" || parts[1] !== "scrypt") {
    return null;
  }
  const params = new Map(parts[2].split(",").map((pair) => pair.split("=") as [string, string | undefined]));
  try {
    const settings = {
      hash: base64UrlToBytes(parts[4]),
      ln: parseNumber(params.get("ln")),
      p: parseNumber(params.get("p")),
      r: parseNumber(params.get("r")),
      salt: base64UrlToBytes(parts[3]),
    };
    return withinBounds(settings) ? settings : null;
  } catch {
    // Not valid base64url: this is not a current-format hash (callers fall back to legacy parsing).
    return null;
  }
};

/**
 * LEGACY, VERIFY-ONLY. Two incompatible formats were written by earlier releases, both
 * `scrypt$<N>$<r>$<p>$<salt>$<hash>` with N = 16384 and p = 1:
 * - Node build: salt and hash are hex; the salt STRING itself (not its bytes) was the scrypt salt;
 * - Workers build: salt and hash are base64url and the salt was decoded to bytes.
 * Production users registered through the Workers build, but both are accepted so no account is
 * locked out. A successful login immediately rewrites the hash in the current format
 * (`needsRehash`), and no legacy hash is ever produced again.
 * Removal condition: delete this function once no `password_hash` in production still starts
 * with `scrypt$` (check with `SELECT COUNT(*) FROM auth_users WHERE password_hash LIKE 'scrypt$%'`).
 */
const parseLegacyFormats = (stored: string): ScryptSettings[] => {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return [];
  }
  const [, rawCost, rawR, rawP, rawSalt, rawHash] = parts;
  const cost = parseNumber(rawCost);
  const ln = Number.isInteger(Math.log2(cost)) ? Math.log2(cost) : Number.NaN;
  const r = parseNumber(rawR);
  const p = parseNumber(rawP);
  const candidates: ScryptSettings[] = [];

  if (/^(?:[0-9a-f]{2})+$/i.test(rawSalt) && /^(?:[0-9a-f]{2})+$/i.test(rawHash)) {
    candidates.push({ hash: hexToBytes(rawHash), ln, p, r, salt: new TextEncoder().encode(rawSalt) });
  }
  try {
    candidates.push({ hash: base64UrlToBytes(rawHash), ln, p, r, salt: base64UrlToBytes(rawSalt) });
  } catch {
    // Not base64url: only the hex interpretation (if any) applies.
  }
  return candidates.filter(withinBounds);
};

export type PasswordVerification = { needsRehash: boolean; valid: boolean };

const isCurrent = ({ hash, ln, p, r }: ScryptSettings) =>
  ln >= SCRYPT_PARAMS.ln && r >= SCRYPT_PARAMS.r && p >= SCRYPT_PARAMS.p && hash.length >= SCRYPT_PARAMS.keyLength;

export const verifyPassword = async (password: string, stored: string): Promise<PasswordVerification> => {
  const current = parseCurrentFormat(stored);
  const candidates = current ? [current] : parseLegacyFormats(stored);

  for (const settings of candidates) {
    const derived = await derive(password, settings.salt, settings.hash.length, settings.ln, settings.r, settings.p);
    if (derived.length === settings.hash.length && timingSafeEqual(derived, settings.hash)) {
      return { needsRehash: current === null || !isCurrent(settings), valid: true };
    }
  }
  return { needsRehash: false, valid: false };
};

/**
 * Hash of an unguessable password, produced with the CURRENT parameters. Unknown-email logins
 * verify against it so they cost as much as real ones (no timing-based account enumeration).
 * A test pins these parameters to SCRYPT_PARAMS; regenerate it when the parameters change.
 */
export const DUMMY_PASSWORD_HASH = "$scrypt$ln=14,r=8,p=5$bqNlbc__CFwYC4IwnW7lkg$npsVlP4RvgftZYdyowQr1iEHQa3oBwvMvc1zNXzOGw0";
