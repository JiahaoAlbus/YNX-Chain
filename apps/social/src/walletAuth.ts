import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const REQUESTING_PRODUCT = "social";
export const PRODUCT_CLIENT_ID = "ynx-social-v1";
export const BUNDLE_ID = "com.ynx.social";
export const CALLBACK = "ynxsocial://wallet-auth/callback";
export const WALLET_SCOPES = Object.freeze(["account:read", "profile:link"]);
export const PRODUCT_DEVICE_ALGORITHM = "p256-sha256";

export type WalletAuthorizationRequest = Readonly<{
  version: "1";
  nonce: string;
  chainId: "ynx_6423-1";
  requestingProduct: typeof REQUESTING_PRODUCT;
  productClientId: typeof PRODUCT_CLIENT_ID;
  bundleId: typeof BUNDLE_ID;
  productDeviceAlgorithm: typeof PRODUCT_DEVICE_ALGORITHM;
  productDeviceKey: string;
  callback: typeof CALLBACK;
  scopes: readonly string[];
  purpose: string;
  issuedAt: string;
  expiresAt: string;
}>;
export type WalletApproval = Readonly<{
  version: "1";
  requestDigest: string;
  nonce: string;
  chainId: "ynx_6423-1";
  requestingProduct: typeof REQUESTING_PRODUCT;
  productClientId: typeof PRODUCT_CLIENT_ID;
  bundleId: typeof BUNDLE_ID;
  productDeviceAlgorithm: typeof PRODUCT_DEVICE_ALGORITHM;
  productDeviceKey: string;
  callback: typeof CALLBACK;
  account: string;
  accountPublicKey: string;
  grantedScopes: readonly string[];
  purpose: string;
  issuedAt: string;
  expiresAt: string;
  walletSignature: string;
}>;
export type ProductSessionChallenge = Readonly<{
  version: "1";
  challenge: string;
  requestDigest: string;
  productClientId: string;
  bundleId: string;
  productDeviceAlgorithm: string;
  productDeviceKey: string;
  account: string;
  scopes: readonly string[];
  issuedAt: string;
  expiresAt: string;
}>;
export type WalletLogin = Readonly<{
  challenge: ProductSessionChallenge;
  deviceSignature: string;
  deviceId: string;
  deviceSigningPublicKey: string;
  deviceEncryptionPublicKey: string;
  deviceProofSignature: string;
  chatRegistrationSignature: string;
  squareRegistrationSignature: string;
}>;

const REQUEST_FIELDS = [
  "version",
  "nonce",
  "chainId",
  "requestingProduct",
  "productClientId",
  "bundleId",
  "productDeviceAlgorithm",
  "productDeviceKey",
  "callback",
  "scopes",
  "purpose",
  "issuedAt",
  "expiresAt",
];
const APPROVAL_FIELDS = [
  "version",
  "requestDigest",
  "nonce",
  "chainId",
  "requestingProduct",
  "productClientId",
  "bundleId",
  "productDeviceAlgorithm",
  "productDeviceKey",
  "callback",
  "account",
  "accountPublicKey",
  "grantedScopes",
  "purpose",
  "issuedAt",
  "expiresAt",
  "walletSignature",
];
const CHALLENGE_FIELDS = [
  "version",
  "challenge",
  "requestDigest",
  "productClientId",
  "bundleId",
  "productDeviceAlgorithm",
  "productDeviceKey",
  "account",
  "scopes",
  "issuedAt",
  "expiresAt",
];

export function createWalletRequest(
  nonce: string,
  productDeviceKey: string,
  now = new Date(),
): WalletAuthorizationRequest {
  validNonce(nonce);
  validP256Key(productDeviceKey);
  const issuedAt = exactTime(now),
    expiresAt = exactTime(new Date(now.getTime() + 5 * 60_000));
  return Object.freeze({
    version: "1",
    nonce,
    chainId: "ynx_6423-1",
    requestingProduct: REQUESTING_PRODUCT,
    productClientId: PRODUCT_CLIENT_ID,
    bundleId: BUNDLE_ID,
    productDeviceAlgorithm: PRODUCT_DEVICE_ALGORITHM,
    productDeviceKey,
    callback: CALLBACK,
    scopes: WALLET_SCOPES,
    purpose: "Sign in to YNX Social. No recovery key is shared.",
    issuedAt,
    expiresAt,
  });
}

export function walletRequestURL(request: WalletAuthorizationRequest): string {
  validateRequest(request, new Date(Date.parse(request.issuedAt)));
  return `ynxwallet://authorize?request=${encodeBase64URL(utf8ToBytes(canonicalJSON(request)))}`;
}

export function requestDigest(request: WalletAuthorizationRequest): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(`YNX_WALLET_AUTH_REQUEST_V1\n${canonicalJSON(request)}`),
    ),
  );
}

export function parseWalletCallback(
  value: string,
  expected: WalletAuthorizationRequest,
  now = new Date(),
): WalletApproval {
  validateRequest(expected, now);
  const url = new URL(value),
    origin = new URL(CALLBACK),
    response = url.searchParams.get("response");
  url.search = "";
  if (
    !response ||
    url.toString() !== origin.toString() ||
    [...new URL(value).searchParams.keys()].join(",") !== "response"
  )
    throw new Error("Wallet callback route or envelope fields are invalid");
  let raw: unknown;
  try {
    raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        decodeBase64URL(response),
      ),
    );
  } catch {
    throw new Error("Wallet response envelope is invalid");
  }
  exactFields(raw, APPROVAL_FIELDS, "Wallet approval");
  const approval = raw as WalletApproval;
  if (
    approval.version !== "1" ||
    approval.requestDigest !== requestDigest(expected) ||
    approval.nonce !== expected.nonce ||
    approval.chainId !== expected.chainId ||
    approval.requestingProduct !== expected.requestingProduct ||
    approval.productClientId !== expected.productClientId ||
    approval.bundleId !== expected.bundleId ||
    approval.productDeviceAlgorithm !== expected.productDeviceAlgorithm ||
    approval.productDeviceKey !== expected.productDeviceKey ||
    approval.callback !== expected.callback ||
    approval.purpose !== expected.purpose ||
    approval.grantedScopes.join("\n") !== expected.scopes.join("\n")
  )
    throw new Error(
      "Wallet approval binding does not match the exact Social request",
    );
  if (
    !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(approval.account) ||
    !/^(02|03)[0-9a-f]{64}$/.test(approval.accountPublicKey) ||
    !/^[0-9a-f]{128}$/.test(approval.walletSignature)
  )
    throw new Error("Wallet approval cryptography is malformed");
  const issued = parseExactTime(approval.issuedAt),
    expires = parseExactTime(approval.expiresAt);
  if (
    issued > now.getTime() + 30_000 ||
    expires <= now.getTime() ||
    expires > parseExactTime(expected.expiresAt) ||
    expires <= issued
  )
    throw new Error("Wallet approval is stale or too broad");
  const unsigned = Object.fromEntries(
      Object.entries(approval).filter(([key]) => key !== "walletSignature"),
    ),
    digest = sha256(
      utf8ToBytes(`YNX_WALLET_AUTH_APPROVAL_V1\n${canonicalJSON(unsigned)}`),
    );
  let verified = false;
  try {
    verified = secp256k1.verify(
      hexToBytes(approval.walletSignature),
      digest,
      hexToBytes(approval.accountPublicKey),
      { prehash: false, format: "compact", lowS: true },
    );
  } catch {
    verified = false;
  }
  if (
    !verified ||
    accountFromPublicKey(approval.accountPublicKey) !== approval.account
  )
    throw new Error("Wallet approval signature is invalid");
  return Object.freeze({
    ...approval,
    grantedScopes: Object.freeze([...approval.grantedScopes]),
  });
}

export function signGatewayChallenge(
  challenge: ProductSessionChallenge,
  productSecret: Uint8Array,
  now = new Date(),
): Readonly<{ challenge: ProductSessionChallenge; deviceSignature: string }> {
  exactFields(challenge, CHALLENGE_FIELDS, "Gateway challenge");
  validP256Key(challenge.productDeviceKey);
  if (
    challenge.version !== "1" ||
    challenge.productClientId !== PRODUCT_CLIENT_ID ||
    challenge.bundleId !== BUNDLE_ID ||
    challenge.productDeviceAlgorithm !== PRODUCT_DEVICE_ALGORITHM ||
    challenge.productDeviceKey !==
      encodeBase64URL(p256.getPublicKey(productSecret, true)) ||
    challenge.scopes.join("\n") !== WALLET_SCOPES.join("\n") ||
    parseExactTime(challenge.issuedAt) > now.getTime() + 30_000 ||
    parseExactTime(challenge.expiresAt) <= now.getTime()
  )
    throw new Error("Gateway challenge binding is invalid");
  const signature = p256.sign(
    utf8ToBytes(
      `YNX_PRODUCT_SESSION_CHALLENGE_V1\n${canonicalJSON(challenge)}`,
    ),
    productSecret,
    { format: "der" },
  );
  return Object.freeze({
    challenge,
    deviceSignature: encodeBase64URL(signature),
  });
}

export function deviceProofPayload(input: {
  approval: WalletApproval;
  challenge: ProductSessionChallenge;
  deviceId: string;
  deviceSigningPublicKey: string;
  deviceEncryptionPublicKey: string;
}): Uint8Array {
  return text([
    "ynx-social-device-proof-v2",
    input.approval.account,
    input.deviceId,
    input.deviceSigningPublicKey,
    input.deviceEncryptionPublicKey,
    input.approval.requestDigest,
    input.challenge.challenge,
  ]);
}
export function squareRegistrationPayload(
  approval: WalletApproval,
  deviceId: string,
  deviceSigningPublicKey: string,
  idempotencyKey: string,
): Uint8Array {
  return text([
    "ynx-square-device-register-v1",
    approval.account,
    deviceId,
    deviceSigningPublicKey,
    idempotencyKey,
  ]);
}
export function chatRegistrationPayload(
  approval: WalletApproval,
  deviceId: string,
  deviceSigningPublicKey: string,
  deviceEncryptionPublicKey: string,
  idempotencyKey: string,
): Uint8Array {
  return text([
    "ynx-chat-device-register-v1",
    approval.account,
    deviceId,
    deviceSigningPublicKey,
    deviceEncryptionPublicKey,
    idempotencyKey,
  ]);
}
export function registrationIdempotencyKey(
  kind: string,
  digest: string,
): string {
  return `${kind}-${bytesToHex(sha256(utf8ToBytes(digest))).slice(0, 24)}`;
}
export function base64Raw(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/=+$/g, "");
}
export function encodeBase64URL(value: Uint8Array): string {
  return base64Raw(value).replace(/\+/g, "-").replace(/\//g, "_");
}

function validateRequest(request: WalletAuthorizationRequest, now: Date) {
  exactFields(request, REQUEST_FIELDS, "Wallet request");
  validNonce(request.nonce);
  validP256Key(request.productDeviceKey);
  if (
    request.version !== "1" ||
    request.chainId !== "ynx_6423-1" ||
    request.requestingProduct !== REQUESTING_PRODUCT ||
    request.productClientId !== PRODUCT_CLIENT_ID ||
    request.bundleId !== BUNDLE_ID ||
    request.productDeviceAlgorithm !== PRODUCT_DEVICE_ALGORITHM ||
    request.callback !== CALLBACK ||
    request.scopes.join("\n") !== WALLET_SCOPES.join("\n")
  )
    throw new Error("Wallet request product binding is invalid");
  const issued = parseExactTime(request.issuedAt),
    expires = parseExactTime(request.expiresAt);
  if (
    issued > now.getTime() + 30_000 ||
    expires <= now.getTime() ||
    expires <= issued ||
    expires - issued > 5 * 60_000
  )
    throw new Error("Wallet request lifetime is invalid");
}
function exactFields(value: unknown, fields: string[], label: string) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== [...fields].sort().join("\n")
  )
    throw new Error(
      `${label} fields do not match the canonical protocol schema`,
    );
}
function validNonce(value: string) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(value))
    throw new Error("Wallet nonce is invalid");
}
function validP256Key(value: string) {
  if (!/^[A-Za-z0-9_-]{44}$/.test(value))
    throw new Error("Product device key is invalid");
  const bytes = decodeBase64URL(value);
  if (bytes.length !== 33 || encodeBase64URL(bytes) !== value)
    throw new Error("Product device key is not canonical");
  try {
    p256.Point.fromBytes(bytes);
  } catch {
    throw new Error("Product device key is invalid");
  }
}
function exactTime(value: Date): string {
  if (!Number.isFinite(value.getTime()))
    throw new Error("Protocol time is invalid");
  return value.toISOString();
}
function parseExactTime(value: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    new Date(value).toISOString() !== value
  )
    throw new Error("Protocol time is invalid");
  return Date.parse(value);
}
function decodeBase64URL(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.includes("="))
    throw new Error("Non-canonical base64url");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized), (character) =>
    character.charCodeAt(0),
  );
}
function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new Error("Protocol number is invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (!value || typeof value !== "object")
    throw new Error("Protocol value is not canonical JSON");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`)
    .join(",")}}`;
}
function accountFromPublicKey(publicKeyHex: string): string {
  const point = secp256k1.Point.fromBytes(hexToBytes(publicKeyHex)),
    digest = keccak_256(point.toBytes(false).slice(1));
  return encodeYNX(digest.slice(-20));
}
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function encodeYNX(payload: Uint8Array) {
  const data = convertBits(payload, 8, 5, true),
    values = [...hrpExpand("ynx"), ...data, 0, 0, 0, 0, 0, 0],
    checksum = polymod(values) ^ 1,
    tail = Array.from(
      { length: 6 },
      (_, index) => (checksum >>> (5 * (5 - index))) & 31,
    );
  return `ynx1${[...data, ...tail].map((item) => CHARSET[item]).join("")}`;
}
function convertBits(
  data: Uint8Array,
  fromBits: number,
  toBits: number,
  pad: boolean,
) {
  let accumulator = 0,
    bits = 0;
  const result: number[] = [],
    maxValue = (1 << toBits) - 1,
    maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & maxValue);
    }
  }
  if (pad && bits > 0) result.push((accumulator << (toBits - bits)) & maxValue);
  return result;
}
function hrpExpand(hrp: string) {
  return [...hrp]
    .map((c) => c.charCodeAt(0) >> 5)
    .concat(
      [0],
      [...hrp].map((c) => c.charCodeAt(0) & 31),
    );
}
function polymod(values: number[]) {
  const generators = [
    0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
  ];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    generators.forEach((generator, index) => {
      if ((top >>> index) & 1) checksum = (checksum ^ generator) >>> 0;
    });
  }
  return checksum >>> 0;
}
function text(values: string[]): Uint8Array {
  return new TextEncoder().encode(values.join("\n"));
}
