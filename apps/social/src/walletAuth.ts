export const CLIENT_ID = "com.ynx.social";
export const CALLBACK = "ynxsocial://auth/callback";
export const SCOPES = Object.freeze(["social.profile", "social.contacts", "social.messaging", "social.feed", "social.ai"]);

export type WalletAssertion = Readonly<{ account: string; publicKey: string; deviceId: string; deviceSigningPublicKey:string; deviceEncryptionPublicKey:string; deviceProofSignature?:string; chatRegistrationSignature?:string; squareRegistrationSignature?:string; clientId: string; callback: string; scopes: string[]; nonce: string; issuedAt: string; expiresAt: string; signature: string }>;

export function walletRequestURL(nonce: string, deviceId: string, deviceSigningPublicKey: string,deviceEncryptionPublicKey:string): string {
  if (!identifier(nonce) || !identifier(deviceId) || !/^[A-Za-z0-9+/]{43}$/.test(deviceSigningPublicKey)|| !/^[A-Za-z0-9+/]{43}$/.test(deviceEncryptionPublicKey)) throw new Error("Invalid Social device authorization request");
  const query = new URLSearchParams({ product: "ynx-social", clientId: CLIENT_ID, callback: CALLBACK, chainId: "ynx_6423-1", scopes: SCOPES.join(","), nonce, deviceId, deviceSigningPublicKey,deviceEncryptionPublicKey, purpose: "Sign in to YNX Social. No recovery key is shared." });
  return `ynxwallet://authorize?${query.toString()}`;
}

export function parseWalletCallback(value: string, expectedNonce: string, expectedDevice: string, expectedDevicePublicKey:string,expectedEncryptionPublicKey:string, now = new Date()): WalletAssertion {
  const url = new URL(value);
  if (url.protocol !== "ynxsocial:" || url.hostname !== "auth" || url.pathname !== "/callback") throw new Error("Wallet returned to an unexpected callback");
  const allowed = new Set(["assertion"]); for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw new Error("Wallet callback contains unknown fields");
  const encoded = url.searchParams.get("assertion"); if (!encoded) throw new Error("Wallet assertion is missing");
  let raw: unknown; try { raw = JSON.parse(decodeBase64URL(encoded)); } catch { throw new Error("Wallet assertion must be bounded JSON"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Wallet assertion must be an object");
  const object = raw as Record<string, unknown>; const keys = ["account","publicKey","deviceId","deviceSigningPublicKey","deviceEncryptionPublicKey","clientId","callback","scopes","nonce","issuedAt","expiresAt","signature"];
  if (Object.keys(object).some((key) => !keys.includes(key)) || keys.some((key) => !(key in object))) throw new Error("Wallet assertion fields are invalid");
  if (object.clientId !== CLIENT_ID || object.callback !== CALLBACK || object.nonce !== expectedNonce || object.deviceId !== expectedDevice || object.deviceSigningPublicKey !== expectedDevicePublicKey||object.deviceEncryptionPublicKey!==expectedEncryptionPublicKey) throw new Error("Wallet assertion binding does not match this Social request");
  if (!Array.isArray(object.scopes)) throw new Error("Wallet assertion scopes do not match"); const scopes=object.scopes as unknown[];
  if (scopes.length !== SCOPES.length || SCOPES.some((scope) => !scopes.includes(scope))) throw new Error("Wallet assertion scopes do not match");
  const issued = new Date(String(object.issuedAt)), expires = new Date(String(object.expiresAt)); if (!Number.isFinite(issued.getTime()) || !Number.isFinite(expires.getTime()) || issued.getTime() > now.getTime() + 30_000 || issued.getTime() < now.getTime() - 300_000 || expires.getTime() <= now.getTime() || expires.getTime() > issued.getTime() + 300_000) throw new Error("Wallet assertion is stale or too broad");
  if (!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38,80}$/.test(String(object.account)) || !/^[0-9a-f]{66}$/i.test(String(object.publicKey)) || !/^[A-Za-z0-9+/]{43}$/.test(String(object.deviceSigningPublicKey)) || !/^[A-Za-z0-9+/]{43}$/.test(String(object.deviceEncryptionPublicKey)) || !/^[0-9a-f]+$/i.test(String(object.signature))) throw new Error("Wallet assertion cryptography is malformed");
  return Object.freeze(object as WalletAssertion);
}

export function deviceProofPayload(assertion:WalletAssertion):Uint8Array{return text(["ynx-social-device-proof-v1",assertion.account,assertion.deviceId,assertion.deviceSigningPublicKey,assertion.deviceEncryptionPublicKey,assertion.nonce])}
export function squareRegistrationPayload(assertion:WalletAssertion,idempotencyKey:string):Uint8Array{return text(["ynx-square-device-register-v1",assertion.account,assertion.deviceId,assertion.deviceSigningPublicKey,idempotencyKey])}
export function chatRegistrationPayload(assertion:WalletAssertion,idempotencyKey:string):Uint8Array{return text(["ynx-chat-device-register-v1",assertion.account,assertion.deviceId,assertion.deviceSigningPublicKey,assertion.deviceEncryptionPublicKey,idempotencyKey])}
export function base64Raw(value:Uint8Array):string{return btoa(String.fromCharCode(...value)).replace(/=+$/g,"")}
function text(values:string[]):Uint8Array{return new TextEncoder().encode(values.join("\n"))}

function identifier(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/.test(value); }
function decodeBase64URL(value: string): string { if (!/^[A-Za-z0-9_-]{1,16384}$/.test(value)) throw new Error("Invalid base64url"); const normalized = value.replace(/-/g,"+").replace(/_/g,"/"); return decodeURIComponent(Array.from(atob(normalized), (character) => `%${character.charCodeAt(0).toString(16).padStart(2,"0")}`).join("")); }
