// SSRF guards for every URL the offline generator fetches on behalf of an opportunity record.
// The URLs come from scraped notices, so they are untrusted input: only public http(s) hosts on
// ordinary ports are allowed, never credentials, loopback, private, link-local or metadata
// addresses. Hostnames are checked here; the resolved addresses are checked again at connect time
// by safe-fetch (a hostname that resolves to a private address is as bad as a private literal).
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(
    readonly reason: string,
    readonly url: string,
  ) {
    super(`unsafe url (${reason}): ${url}`);
    this.name = "UnsafeUrlError";
  }
}

const allowedPorts = new Set(["", "80", "443", "8080", "8443"]);
const blockedHostSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".intranet",
];

const parseIpv4 = (address: string): number[] | null => {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
};

const isPrivateIpv4 = (octets: number[]) => {
  const [a, b, c] = octets;
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
};

/** Expand an IPv6 literal into eight 16-bit groups, or null when it is not valid IPv6. */
const parseIpv6 = (address: string): number[] | null => {
  let text = address.split("%")[0].toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) {
      return null;
    }
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${(
      (v4[2] << 8) |
      v4[3]
    ).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) {
    return null;
  }
  const toGroups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) {
    return null;
  }
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const numbers = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN));
  return numbers.length === 8 && numbers.every((value) => !Number.isNaN(value)) ? numbers : null;
};

const embeddedIpv4 = (high: number, low: number) => [high >> 8, high & 0xff, low >> 8, low & 0xff];

/** True for any address that must never be fetched: private, loopback, link-local, reserved. */
export const isPrivateAddress = (address: string): boolean => {
  const v4 = parseIpv4(address);
  if (v4) {
    return isPrivateIpv4(v4);
  }

  const g = parseIpv6(address);
  if (!g) {
    return true; // not an address we can reason about: refuse
  }
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  if (g.every((group) => group === 0)) {
    return true; // ::
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) {
    return true; // ::1
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return isPrivateIpv4(embeddedIpv4(g6, g7)); // IPv4-mapped / IPv4-compatible
  }
  if (g0 === 0x64 && g1 === 0xff9b) {
    return isPrivateIpv4(embeddedIpv4(g6, g7)); // NAT64
  }
  if (g0 === 0x2002) {
    return isPrivateIpv4(embeddedIpv4(g1, g2)); // 6to4
  }
  return (
    (g0 & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g0 & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g0 & 0xff00) === 0xff00 || // multicast
    (g0 === 0x2001 && g1 === 0x0db8) // documentation
  );
};

/**
 * Parse and vet a URL. Returns the parsed URL or throws `UnsafeUrlError`.
 * Hostnames are only checked syntactically here (literals, reserved names, single labels).
 */
export const parsePublicHttpUrl = (raw: string | URL, base?: string | URL): URL => {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw, base) : raw;
  } catch {
    throw new UnsafeUrlError("unparseable", String(raw));
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("scheme", url.href);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("credentials", url.href);
  }
  if (!allowedPorts.has(url.port)) {
    throw new UnsafeUrlError("port", url.href);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hostname) {
    throw new UnsafeUrlError("empty-host", url.href);
  }
  if (isIP(hostname) !== 0) {
    if (isPrivateAddress(hostname)) {
      throw new UnsafeUrlError("private-address", url.href);
    }
    return url;
  }
  if (
    hostname === "localhost" ||
    !hostname.includes(".") ||
    blockedHostSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new UnsafeUrlError("non-public-host", url.href);
  }
  return url;
};
