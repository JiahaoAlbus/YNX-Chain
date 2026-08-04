import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function exactFields(value, expected, label) {
  if (!isPlainObject(value)) throw new WalletAuthError("INVALID_SHAPE", `${label} must be a JSON object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\n") !== wanted.join("\n")) throw new WalletAuthError("UNKNOWN_OR_MISSING_FIELD", `${label} fields do not match the protocol schema`);
}

export function canonicalJSON(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new WalletAuthError("INVALID_NUMBER", "Protocol numbers must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (!isPlainObject(value)) throw new WalletAuthError("INVALID_SHAPE", "Protocol value is not canonical JSON");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
}

export function digestHex(domain, value) {
  return bytesToHex(sha256(utf8ToBytes(`${domain}\n${canonicalJSON(value)}`)));
}

export class WalletAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WalletAuthError";
    this.code = code;
  }
}
