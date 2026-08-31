// Central canonical authorize source: 46386ae8eeaa7633923ae762a5a9634b5eac98d9.
// The app must only use these root exports; no product code may construct a
// Wallet authorize URL or decode an authorization callback itself.
import { encodeRequestDeepLink, parseAuthorizationCallbackURL, type AuthorizationResponse } from "../../../vendor/wallet-auth/src/index.js";

export type DeveloperWalletBridge = {
  openAuthorization: (deepLink: string) => Promise<void>;
  walletAvailability?: () => Promise<{ walletInstalled: boolean; schemeRegistered: boolean }>;
  protectedStorage?: {
    securityLevel: "os-protected";
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
};

declare global {
  interface Window {
    ynxDesktopWallet?: DeveloperWalletBridge;
  }
}

const binding = Object.freeze({
  version: "1",
  chainId: "ynx_6423-1",
  requestingProduct: "developer",
  productClientId: "ynx-developer-v1",
  bundleId: "com.ynxweb4.developer.testnetpreview",
  productDeviceAlgorithm: "p256-sha256",
  callback: "ynxdeveloper://wallet-auth/callback",
  scopes: Object.freeze(["account:read", "developer:deploy"]),
});

export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Wallet protocol numbers must be safe integers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Wallet request is not canonical JSON.");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(",")}}`;
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function desktopWalletBridge(): DeveloperWalletBridge | undefined {
  const candidate = window.ynxDesktopWallet;
  return candidate && typeof candidate.openAuthorization === "function" ? candidate : undefined;
}

export async function developerWalletV2Device() {
  const pair = await productDeviceKeyPair(), key = await productDevicePublicKey();
  return Object.freeze({
    id: "ynx-developer-macos-device-v2",
    key,
    scopes: Object.freeze(["account:read", "developer:deploy"]),
    purpose: "Connect YNX Developer through the canonical Wallet Product Session v2 factory.",
    async sign(input: { purpose: "challenge" | "http-proof"; algorithm: "p256-sha256"; deviceKey: string; payload: string }) {
      if ((input.purpose !== "challenge" && input.purpose !== "http-proof") || input.algorithm !== "p256-sha256" || input.deviceKey !== key) throw new Error("Developer Wallet v2 signer request is not bound to this device.");
      const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, decodeBase64url(input.payload)));
      return base64url(derSignature(signature));
    },
  });
}

export async function openDeveloperWalletReview(bridge: DeveloperWalletBridge, now = new Date()) {
  const productDeviceKey = await productDevicePublicKey();
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  const request = Object.freeze({
    ...binding,
    productDeviceKey,
    nonce: base64url(crypto.getRandomValues(new Uint8Array(32))),
    purpose: "Sign in to YNX Developer and review one exact Testnet deployment.",
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const deepLink = encodeRequestDeepLink(request);
  sessionStorage.setItem(PENDING_REQUEST, canonicalJSON(request));
  try { await bridge.openAuthorization(deepLink); }
  catch (error) { sessionStorage.removeItem(PENDING_REQUEST); throw error; }
  return Object.freeze({ status: "wallet-review-opened" as const, expiresAt: request.expiresAt });
}

type StoredDevice = { version: 1; privateKey: CryptoKey; publicKey: CryptoKey };
const DATABASE = "ynx-code-wallet-v1", STORE = "product-device-keys", KEY = "ynx-developer-v1";
const PENDING_REQUEST = "ynx-code-wallet-pending-v1";

export function subscribeDeveloperWalletCallbacks(listener: (callbackURL: string) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail === "string") listener(detail);
  };
  window.addEventListener("ynx-wallet-callback", handler);
  return () => window.removeEventListener("ynx-wallet-callback", handler);
}

export async function createDeveloperWalletCompletion(callbackURL: string, now = new Date()) {
  const request = pendingAuthorizationRequest(now), approval = callbackApproval(callbackURL, request, now);
  const issuedAt = now.toISOString(), expiresAt = new Date(Math.min(Date.parse(approval.expiresAt as string), now.getTime() + 90_000)).toISOString();
  if (expiresAt <= issuedAt) throw new Error("YNX Wallet approval expired before the device challenge could be signed.");
  const challenge = Object.freeze({
    version: "1", challenge: base64url(crypto.getRandomValues(new Uint8Array(32))), requestDigest: approval.requestDigest,
    productClientId: approval.productClientId, bundleId: approval.bundleId, productDeviceAlgorithm: approval.productDeviceAlgorithm,
    productDeviceKey: approval.productDeviceKey, account: approval.account, scopes: approval.grantedScopes, issuedAt, expiresAt,
  });
  const pair = await productDeviceKeyPair();
  const signed = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(`YNX_PRODUCT_SESSION_CHALLENGE_V1\n${canonicalJSON(challenge)}`)));
  const completion = Object.freeze({ authorizationRequest: request, walletApproval: approval, gatewayCompletion: { challenge, deviceSignature: base64url(derSignature(signed)) } });
  return Object.freeze({ body: canonicalJSON(completion), account: approval.account, expiresAt });
}

export function consumeDeveloperWalletRequest() { sessionStorage.removeItem(PENDING_REQUEST); }

const ACTIVE_SESSION = "ynx-code-wallet-session-v1";
type DeveloperSession = { sessionBinding:string;productClientId:"ynx-developer-v1";bundleId:"com.ynxweb4.developer.testnetpreview";productDeviceKey:string;account:string;scopes:string[];issuedAt:string;expiresAt:string };

export async function saveDeveloperWalletSession(input: DeveloperSession, now = new Date()) {
  const expectedKey = await productDevicePublicKey();
  if (input.productClientId !== binding.productClientId || input.bundleId !== binding.bundleId || input.productDeviceKey !== expectedKey || !/^[0-9a-f]{64}$/.test(input.sessionBinding) || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(input.account) || !sameStrings(input.scopes, binding.scopes) || !validTime(input.issuedAt) || !validTime(input.expiresAt) || Date.parse(input.expiresAt) <= now.getTime()) throw new Error("Wallet Gateway session does not match this Developer device.");
  sessionStorage.setItem(ACTIVE_SESSION, canonicalJSON(input));
}

export async function createDeveloperSessionIntrospection(now = new Date()) {
  const session = activeDeveloperSession(now), body = canonicalJSON({ requiredScopes:["developer:deploy"] }), bodyDigest = await sha256Hex(new TextEncoder().encode(body));
  const issuedAt = now.toISOString(), expiresAt = new Date(Math.min(Date.parse(session.expiresAt), now.getTime() + 60_000)).toISOString();
  if (expiresAt <= issuedAt) throw new Error("Developer Wallet session expired.");
  const unsigned = { version:"1",sessionBinding:session.sessionBinding,productClientId:session.productClientId,bundleId:session.bundleId,productDeviceKey:session.productDeviceKey,method:"POST",path:"/v1/wallet/sessions/introspect",bodyDigest,nonce:base64url(crypto.getRandomValues(new Uint8Array(32))),issuedAt,expiresAt };
  const pair=await productDeviceKeyPair(),signed=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},pair.privateKey,new TextEncoder().encode(`YNX_PRODUCT_SESSION_HTTP_PROOF_V1\n${canonicalJSON(unsigned)}`))),proof={...unsigned,signature:base64url(derSignature(signed))};
  return Object.freeze({body:canonicalJSON({proof}),session});
}

export type DeveloperDeploymentInput = { name:string;source:string;deployedBytecode:string;constructorArgs:string[];nonce:number;blockNumber:number;gasEstimate:string;gasPriceWei:string;maxFeeWei:string;compilerVersion:string };
const PENDING_DEPLOYMENT = "ynx-code-deployment-pending-v1";

export async function openDeveloperDeploymentReview(bridge: DeveloperWalletBridge, input: DeveloperDeploymentInput, now = new Date()) {
  const session=activeDeveloperSession(now),source=input.source.trim(),deployedBytecode=input.deployedBytecode.toLowerCase().startsWith("0x")?input.deployedBytecode.toLowerCase():`0x${input.deployedBytecode.toLowerCase()}`;
  if(!/^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(input.name)||source.length<1||source.length>4096||!/^0x[0-9a-f]{2,12288}$/.test(deployedBytecode)||deployedBytecode.length%2||!Number.isSafeInteger(input.nonce)||input.nonce<1||!Number.isSafeInteger(input.blockNumber)||input.blockNumber<1||input.constructorArgs.length>16||input.constructorArgs.some(value=>typeof value!=="string"||value.trim()!==value||value.length>256))throw new Error("Deployment artifact, constructor, block or account nonce is outside the bounded YNX action profile.");
  const idempotencyKey=`developer-${base64url(crypto.getRandomValues(new Uint8Array(24)))}`,base={name:input.name,source,deployedBytecode,constructorArgs:[...input.constructorArgs],idempotencyKey},requestHash=await sha256Hex(new TextEncoder().encode(JSON.stringify({domain:"YNX_IDE_REQUEST_V1",action:"ide_contract_deploy",value:base}))),payload={...base,requestHash},artifactDigest=await sha256Hex(new TextEncoder().encode(`YNX_DEVELOPER_ARTIFACT_V1\n${canonicalJSON(base)}`)),issuedAt=now.toISOString();
  const request={version:"1",chainId:6423,productClientId:binding.productClientId,bundleId:binding.bundleId,callback:"ynxdeveloper://deployment/callback",sessionBinding:session.sessionBinding,account:session.account,nonce:input.nonce,action:"ide_contract_deploy",payload,artifactDigest,simulation:{chainId:6423,blockNumber:input.blockNumber,gasEstimate:decimal(input.gasEstimate,"gas estimate"),gasPriceWei:decimal(input.gasPriceWei,"gas price"),maxFeeWei:decimal(input.maxFeeWei,"maximum fee"),compilerVersion:input.compilerVersion,artifactDigest,source:"https://rpc.ynxweb4.com/",asOf:issuedAt},issuedAt,expiresAt:new Date(now.getTime()+5*60_000).toISOString()};
  const encoded=canonicalJSON(request);sessionStorage.setItem(PENDING_DEPLOYMENT,encoded);const link=`ynxwallet://developer-deploy?request=${base64url(new TextEncoder().encode(encoded))}`;try{await bridge.openAuthorization(link)}catch(error){sessionStorage.removeItem(PENDING_DEPLOYMENT);throw error}return Object.freeze({status:"deployment-review-opened" as const,expiresAt:request.expiresAt,artifactDigest});
}

export function subscribeDeveloperDeploymentCallbacks(listener:(callbackURL:string)=>void){const handler=(event:Event)=>{const detail=(event as CustomEvent<unknown>).detail;if(typeof detail==="string")listener(detail)};window.addEventListener("ynx-deployment-callback",handler);return()=>window.removeEventListener("ynx-deployment-callback",handler)}

export async function parseDeveloperDeploymentCallback(callbackURL:string,now=new Date()){
  const encoded=sessionStorage.getItem(PENDING_DEPLOYMENT);if(!encoded)throw new Error("No pending Developer deployment exists on this device.");let request:Record<string,unknown>;try{request=plainRecord(JSON.parse(encoded),"Pending Developer deployment")}catch{throw new Error("Pending Developer deployment is corrupted.")}
  let url:URL;try{url=new URL(callbackURL)}catch{throw new Error("Developer deployment callback is invalid.")}const keys=[...url.searchParams.keys()],response=keys.length===1&&keys[0]==="response"?url.searchParams.get("response"):null;if(url.protocol!=="ynxdeveloper:"||url.hostname!=="deployment"||url.pathname!=="/callback"||url.hash||url.username||url.password||!response)throw new Error("Developer deployment callback route was substituted.");
  let value:Record<string,unknown>;try{value=plainRecord(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decodeBase64url(response))),"Developer deployment response")}catch{throw new Error("Developer deployment response is invalid.")}
  const fields=["version","requestDigest","productClientId","bundleId","callback","sessionBinding","account","action","artifactDigest","signedTransaction","canonicalPayloadHex","transactionHash","issuedAt","expiresAt"];exactFields(value,fields,"Developer deployment response");for(const key of ["productClientId","bundleId","callback","sessionBinding","account","action","artifactDigest"])if(value[key]!==request[key])throw new Error(`Developer deployment ${key} binding changed.`);if(value.version!=="1"||typeof value.requestDigest!=="string"||!/^[0-9a-f]{64}$/.test(value.requestDigest)||!validTime(value.issuedAt)||!validTime(value.expiresAt)||Date.parse(value.expiresAt as string)<=now.getTime()||typeof value.transactionHash!=="string"||!/^0x[0-9a-f]{64}$/.test(value.transactionHash)||typeof value.canonicalPayloadHex!=="string"||!/^0x[0-9a-f]+$/.test(value.canonicalPayloadHex)||value.canonicalPayloadHex.length%2)throw new Error("Developer deployment response fields are invalid.");
  const signed=plainRecord(value.signedTransaction,"Developer signed transaction"),payload=plainRecord(signed.payload,"Developer signed payload"),pendingPayload=plainRecord(request.payload,"Pending deployment payload");if(signed.version!==1||signed.chainId!==6423||signed.type!=="application_action"||signed.action!=="ide_contract_deploy"||signed.nonce!==request.nonce||signed.fee!==1||signed.aiUnits!==0||signed.payUnits!==0||payload.requestHash!==pendingPayload.requestHash||typeof signed.signature!=="string"||!/^30[0-9a-f]{134,142}$/.test(signed.signature))throw new Error("Developer signed transaction was widened or is malformed.");
  const canonicalTransaction=JSON.stringify(signed),expectedHex=`0x${[...new TextEncoder().encode(canonicalTransaction)].map(byte=>byte.toString(16).padStart(2,"0")).join("")}`,expectedHash=`0x${await sha256Hex(new TextEncoder().encode(canonicalTransaction))}`;if(value.canonicalPayloadHex!==expectedHex||value.transactionHash!==expectedHash)throw new Error("Developer transaction bytes or hash do not match the signed envelope.");return Object.freeze({response:value,canonicalPayload:canonicalTransaction,transactionHash:value.transactionHash as string,sessionBinding:request.sessionBinding as string});
}
export function consumeDeveloperDeploymentRequest(){sessionStorage.removeItem(PENDING_DEPLOYMENT)}

export function ynxAccountToEVM(account:string){const charset="qpzry9x8gf2tvdw0s3jn54khce6mua7l";if(!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(account))throw new Error("Developer Wallet account is invalid.");const values=[...account.slice(4)].map(character=>charset.indexOf(character)),data=values.slice(0,-6);let accumulator=0,bits=0;const bytes:number[]=[];for(const value of data){if(value<0)throw new Error("Developer Wallet account is invalid.");accumulator=((accumulator<<5)|value)&4095;bits+=5;while(bits>=8){bits-=8;bytes.push((accumulator>>bits)&255)}}if(bytes.length!==20)throw new Error("Developer Wallet account payload is invalid.");return`0x${bytes.map(byte=>byte.toString(16).padStart(2,"0")).join("")}`}

function activeDeveloperSession(now: Date): DeveloperSession {
  const encoded=sessionStorage.getItem(ACTIVE_SESSION);if(!encoded)throw new Error("Sign in with YNX Wallet before deploying.");let value:unknown;try{value=JSON.parse(encoded)}catch{throw new Error("Stored Developer Wallet session is corrupted.")}
  const session=plainRecord(value,"Stored Developer Wallet session") as DeveloperSession;if(session.productClientId!==binding.productClientId||session.bundleId!==binding.bundleId||!sameStrings(session.scopes,binding.scopes)||!validTime(session.expiresAt)||Date.parse(session.expiresAt)<=now.getTime())throw new Error("Developer Wallet session is inactive or expired.");return session;
}

async function sha256Hex(value: Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer))].map(byte=>byte.toString(16).padStart(2,"0")).join(""); }
function decimal(value:string,label:string){if(!/^(0|[1-9][0-9]{0,77})$/.test(value))throw new Error(`Deployment ${label} is invalid.`);return value}

function pendingAuthorizationRequest(now: Date) {
  const encoded = sessionStorage.getItem(PENDING_REQUEST);
  if (!encoded) throw new Error("No pending Developer Wallet request exists on this device.");
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { throw new Error("Pending Developer Wallet request is corrupted."); }
  const request = plainRecord(value, "Pending Developer Wallet request");
  const fields = ["version","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","scopes","purpose","issuedAt","expiresAt"];
  exactFields(request, fields, "Pending Developer Wallet request");
  if (request.version !== binding.version || request.chainId !== binding.chainId || request.requestingProduct !== binding.requestingProduct || request.productClientId !== binding.productClientId || request.bundleId !== binding.bundleId || request.productDeviceAlgorithm !== binding.productDeviceAlgorithm || request.callback !== binding.callback || !sameStrings(request.scopes, binding.scopes) || typeof request.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(request.nonce) || typeof request.productDeviceKey !== "string" || !/^[A-Za-z0-9_-]{44}$/.test(request.productDeviceKey) || typeof request.purpose !== "string" || !validTime(request.issuedAt) || !validTime(request.expiresAt) || Date.parse(request.expiresAt as string) <= now.getTime()) throw new Error("Pending Developer Wallet request does not match the reviewed product binding.");
  return request;
}

function callbackApproval(callbackURL: string, request: Record<string, unknown>, now: Date): AuthorizationResponse {
  let result: ReturnType<typeof parseAuthorizationCallbackURL>;
  try {
    result = parseAuthorizationCallbackURL(callbackURL, request as Parameters<typeof parseAuthorizationCallbackURL>[1], now);
  } catch {
    throw new Error("YNX Wallet callback failed canonical signature, binding, callback or expiry validation.");
  }
  if ("decision" in result) throw new Error("YNX Wallet rejected the authorization request.");
  return result as AuthorizationResponse;
}

function derSignature(signature: Uint8Array) {
  if (signature.length >= 68 && signature.length <= 72 && signature[0] === 0x30 && signature[1] === signature.length - 2) return signature;
  if (signature.length !== 64) throw new Error("Developer device returned an unsupported P-256 signature.");
  const integer = (part: Uint8Array) => { let offset = 0; while (offset < part.length - 1 && part[offset] === 0) offset++; const body = part.slice(offset), prefix = body[0] & 0x80 ? 1 : 0, value = new Uint8Array(2 + prefix + body.length); value[0] = 0x02; value[1] = prefix + body.length; value.set(body, 2 + prefix); return value; };
  const r = integer(signature.slice(0, 32)), s = integer(signature.slice(32));
  const result = new Uint8Array(2 + r.length + s.length); result[0] = 0x30; result[1] = r.length + s.length; result.set(r, 2); result.set(s, 2 + r.length); return result;
}

function decodeBase64url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("YNX Wallet callback encoding is not canonical.");
  let binary: string;
  try { binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)); } catch { throw new Error("YNX Wallet callback encoding is invalid."); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (base64url(bytes) !== value) throw new Error("YNX Wallet callback encoding is not canonical.");
  return bytes;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} is invalid.`); return value as Record<string, unknown>; }
function exactFields(value: Record<string, unknown>, fields: string[], label: string) { if (Object.keys(value).sort().join("\n") !== [...fields].sort().join("\n")) throw new Error(`${label} fields are invalid.`); }
function sameStrings(value: unknown, expected: unknown) { return Array.isArray(value) && Array.isArray(expected) && value.length === expected.length && value.every((item, index) => item === expected[index]); }
function validTime(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value; }

async function productDevicePublicKey() {
  const pair = await productDeviceKeyPair();
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("Developer P-256 public key is invalid.");
  const compressed = new Uint8Array(33);
  compressed[0] = raw[64] % 2 ? 3 : 2;
  compressed.set(raw.slice(1, 33), 1);
  const encoded = base64url(compressed);
  if (!/^[A-Za-z0-9_-]{44}$/.test(encoded)) throw new Error("Developer product-device public key is not canonical.");
  return encoded;
}

async function productDeviceKeyPair(): Promise<CryptoKeyPair> {
  const database = await openDeviceDatabase();
  try {
    const stored = await transactionRequest<StoredDevice | undefined>(database, "readonly", (store) => store.get(KEY));
    if (stored?.version === 1 && validPair(stored)) return { privateKey: stored.privateKey, publicKey: stored.publicKey };
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    await transactionRequest(database, "readwrite", (store) => store.put({ version: 1, privateKey: pair.privateKey, publicKey: pair.publicKey } satisfies StoredDevice, KEY));
    return pair;
  } finally {
    database.close();
  }
}

function validPair(value: StoredDevice) {
  const privateAlgorithm = value.privateKey?.algorithm as EcKeyAlgorithm | undefined;
  const publicAlgorithm = value.publicKey?.algorithm as EcKeyAlgorithm | undefined;
  return value.privateKey instanceof CryptoKey && value.publicKey instanceof CryptoKey && value.privateKey.type === "private" && value.privateKey.extractable === false && value.privateKey.usages.length === 1 && value.privateKey.usages[0] === "sign" && value.publicKey.type === "public" && value.publicKey.extractable === true && value.publicKey.usages.length === 1 && value.publicKey.usages[0] === "verify" && privateAlgorithm?.name === "ECDSA" && privateAlgorithm.namedCurve === "P-256" && publicAlgorithm?.name === "ECDSA" && publicAlgorithm.namedCurve === "P-256";
}

function openDeviceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Developer product-device storage is unavailable."));
    request.onblocked = () => reject(new Error("Developer product-device storage upgrade is blocked."));
  });
}

function transactionRequest<T = IDBValidKey>(database: IDBDatabase, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode), request = operation(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Developer product-device storage operation failed."));
    transaction.onabort = () => reject(new Error("Developer product-device storage transaction was aborted."));
  });
}
