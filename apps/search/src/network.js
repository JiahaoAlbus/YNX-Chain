import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const LOCAL_NAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google",
]);

function parseIPv4(value) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function parseIPv6(value) {
  let input = value.toLowerCase().split("%")[0];
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const ipv4 = parseIPv4(input.slice(lastColon + 1));
    if (!ipv4) return null;
    input = `${input.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map(part => Number.parseInt(part || "0", 16));
  if (groups.length !== 8 || groups.some(group => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  return groups;
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const octets = parseIPv4(address);
    if (!octets) return false;
    const [a, b, c] = octets;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (family === 6) {
    const groups = parseIPv6(address);
    if (!groups) return false;
    const first = groups[0];
    const allZero = groups.every(group => group === 0);
    const loopback = groups.slice(0, 7).every(group => group === 0) && groups[7] === 1;
    const uniqueLocal = (first & 0xfe00) === 0xfc00;
    const linkLocal = (first & 0xffc0) === 0xfe80;
    const multicast = (first & 0xff00) === 0xff00;
    const documentation = first === 0x2001 && groups[1] === 0x0db8;
    const ipv4Mapped = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff;
    if (ipv4Mapped) {
      const mapped = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
      return isPublicAddress(mapped);
    }
    return !(allZero || loopback || uniqueLocal || linkLocal || multicast || documentation);
  }
  return false;
}

export function validateOutboundUrlSyntax(value, { allowLocal = false } = {}) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const localName = LOCAL_NAMES.has(hostname) || [".localhost", ".local", ".internal", ".home", ".lan"].some(suffix => hostname.endsWith(suffix));
  if (url.username || url.password || url.hash) throw new Error("source URL contains forbidden fields");
  if (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:" && localName)) throw new Error("source must use HTTPS");
  if (localName && !allowLocal) throw new Error("source hostname is local or metadata-only");
  if (isIP(hostname) && !isPublicAddress(hostname) && !allowLocal) throw new Error("source address is not publicly routable");
  return url;
}

export async function assertPublicOutboundUrl(value, { allowLocal = false, resolveHost = lookup } = {}) {
  const url = validateOutboundUrlSyntax(value, { allowLocal });
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (allowLocal && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")) return url;
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error("source address is not publicly routable");
    return url;
  }
  let records;
  try {
    records = await resolveHost(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`source DNS resolution failed: ${error.code ?? error.message}`);
  }
  const addresses = Array.isArray(records) ? records.map(record => typeof record === "string" ? record : record.address) : [records?.address ?? records];
  if (!addresses.length || addresses.some(address => !isPublicAddress(address))) throw new Error("source DNS resolved to a non-public address");
  return url;
}
