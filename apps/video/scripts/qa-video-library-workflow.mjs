#!/usr/bin/env node
// Real, opt-in Testnet business QA. This is not installed-Wallet UI evidence.
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile, lstat, open, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const authOrigin = "https://wallet-auth.ynxweb4.com";
const productOrigin = "https://video.ynxweb4.com";
const viewerOrigin = "https://video.ynxweb4.com";
const apiOrigin = `${productOrigin}/video/api`;
const mediaPath = resolve(root, "internal/video/testdata/ynx-owned-test.mp4");
const expectedMediaHash = "be414db1d01558b11c7592b7d4dc69d0fee8da158997dc477e2fdaf6b9e3ee39";
const scopes = ["video:account", "video:library", "video:playback"];
const args = process.argv.slice(2);
const options = { execute: false, check: false, probe: false,
  sdk: resolve(root, "apps/video/.qa-runtime/sdk-b3e4b5269"), registry: null, identity: null };
const privateDirectory = resolve(root, "apps/video/.qa-private");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const requestId = () => `req_videoqa_${randomBytes(16).toString("hex")}`;
const runId = `videolibraryqa-${new Date().toISOString().replace(/[^0-9]/g, "")}-${randomBytes(4).toString("hex")}`;
const receipt = { schemaVersion: 1, runId, mode: "dry-run", startedAt: new Date().toISOString(),
  authOrigin, productOrigin, apiOrigin, viewerOrigin, chainId: "ynx_6423-1",
  installedWalletVerified: false, browserCallbackVerified: false, browserPlaybackVerified: false,
  qaIdentitySecretsPersisted: false, sessionOrProofPersisted: false, networkWrites: false, complete: false, events: [] };
let sdk;
let registry;
let actors = [];
let currentStep = "arguments";
let receiptPath;

function ensure(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}
function safeCode(error) {
  return typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)
    ? error.code : "QA_STEP_FAILED";
}
function objectId(value) {
  ensure(typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value), "INVALID_OBJECT_ID");
  return value;
}
async function event(step, fields = {}) {
  // Only explicitly selected non-secret fields reach stdout or the receipt.
  const item = { at: new Date().toISOString(), step, ...fields };
  receipt.events.push(item);
  process.stdout.write(`${JSON.stringify(item)}\n`);
  if (receiptPath) await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
}
async function loadInputs() {
  for (let i = 0; i < args.length; i++) {
    if (["--execute", "--check", "--probe"].includes(args[i])) options[args[i].slice(2)] = true;
    else if (["--sdk-dir", "--registry", "--identity-file"].includes(args[i])) {
      const key = args[i] === "--sdk-dir" ? "sdk" : args[i] === "--identity-file" ? "identity" : "registry";
      ensure(args[i + 1] && !args[i + 1].startsWith("--"), "MISSING_ARGUMENT");
      options[key] = resolve(args[++i]);
    } else if (args[i] === "--help") {
      process.stdout.write("Usage: node apps/video/scripts/qa-video-library-workflow.mjs [--check] [--probe] [--execute --identity-file apps/video/.qa-private/NAME.json] [--sdk-dir PATH] [--registry PATH]\nDefault: local plan only. --check: offline SDK signing/callback checks. --probe: public GETs only. --execute requires explicit QA identity custody, issues real Video sessions and tests only dedicated QA library records. Never retries a business mutation automatically.\n");
      return null;
    } else throw Object.assign(new Error("UNKNOWN_ARGUMENT"), { code: "UNKNOWN_ARGUMENT" });
  }
  if (options.identity) ensure(dirname(options.identity) === privateDirectory && /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(basename(options.identity)), "IDENTITY_PATH_NOT_PRIVATE");
  ensure(!options.execute || options.identity !== null, "EXPLICIT_QA_IDENTITY_FILE_REQUIRED");
  options.registry ??= resolve(options.sdk, "product-session-registry.json");
  const modules = ["canonical", "crypto", "product-session-registry", "product-session-v2",
    "product-session-router", "product-session-proof-v2", "product-session-gateway-client", "session-proof"];
  sdk = Object.assign({}, ...await Promise.all(modules.map(name => import(pathToFileURL(resolve(options.sdk, `src/${name}.js`)).href))));
  const registryBytes = await readFile(options.registry);
  registry = sdk.parseProductSessionRegistry(JSON.parse(registryBytes.toString("utf8")));
  const binding = sdk.productPlatformBinding(registry, "video", "web");
  ensure(binding.chainId === "ynx_6423-1" && binding.clientId === "ynx-video-mobile-v1" &&
    binding.applicationId === "com.ynxweb4.video.web" && binding.origin === productOrigin &&
    binding.callback === `${productOrigin}/wallet-auth/callback` && binding.bundleId === null && binding.packageId === null,
  "REGISTRY_BINDING_MISMATCH");
  const media = await readFile(mediaPath);
  ensure(hash(media) === expectedMediaHash, "OWNED_MEDIA_HASH_MISMATCH");
  receipt.registrySHA256 = hash(registryBytes);
  receipt.sdkSourcesSHA256 = Object.fromEntries(await Promise.all(modules.map(async name =>
    [name, hash(await readFile(resolve(options.sdk, `src/${name}.js`)))])));
  receipt.media = { path: "internal/video/testdata/ynx-owned-test.mp4", bytes: media.length, sha256: hash(media) };
  receipt.rightsEvidenceSHA256 = hash(await readFile(resolve(root, "internal/video/testdata/README.md")));
  receipt.mode = options.execute ? "execute" : options.probe ? "read-only-probe" : options.check ? "offline-check" : "dry-run";
  await event("plan", { mode: receipt.mode, applicationId: binding.applicationId, scopes,
    registrySHA256: receipt.registrySHA256, mediaSHA256: receipt.media.sha256,
    operations: ["public health/version/catalog GET", "two real Video v2 sessions", "create/read/save QA playlist", "cross-account deletion rejected", "remove saved video", "delete QA playlist", "subscribe/unsubscribe and preserve initial subscription state", "private history GET", "revoke QA sessions"],
    caveat: "QA signing is not installed Wallet, browser callback, or playback verification. Execute requires a 0600 QA identity file; sessions/proofs remain memory-only. Failed mutations are not automatically retried." });
  return media;
}
function makeActor(role) {
  let secret;
  let identity;
  do {
    secret = randomBytes(32);
    try { identity = sdk.walletIdentity(secret.toString("hex")); }
    catch { secret.fill(0); }
  } while (!identity);
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.privateKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  return { role, account: identity.account, secret,
    deviceSecret: Buffer.from(jwk.d, "base64url"),
    deviceKey: Buffer.concat([Buffer.from([2 + (y.at(-1) & 1)]), x]).toString("base64url"),
    deviceId: `videoqa-${role}-${randomBytes(12).toString("hex")}`, session: null, issuedSessions: [] };
}
async function loadOrCreateQAIdentities() {
  // Limit custody to one reviewed, non-symlink private directory and regular file.
  await mkdir(privateDirectory, { mode: 0o700, recursive: true });
  const directory = await lstat(privateDirectory);
  ensure(directory.isDirectory() && !directory.isSymbolicLink() && (directory.mode & 0o777) === 0o700 &&
    await realpath(privateDirectory) === privateDirectory, "QA_DIRECTORY_NOT_PRIVATE");
  let handle;
  let created = false;
  try { handle = await open(options.identity, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600); created = true; }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  let document;
  if (created) {
    actors = [makeActor("owner"), makeActor("reviewer")];
    document = { schemaVersion: 1, kind: "YNX_TESTNET_QA_IDENTITIES", chainId: "ynx_6423-1",
      publicId: `videoqa-identity-${randomBytes(12).toString("hex")}`, createdAt: new Date().toISOString(),
      identities: actors.map(actor => ({ role: actor.role, account: actor.account, accountSecret: actor.secret.toString("hex"),
        deviceId: actor.deviceId, deviceKey: actor.deviceKey, deviceSecret: actor.deviceSecret.toString("base64url") })) };
    try { await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
  } else {
    handle = await open(options.identity, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      ensure(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600 && stat.size < 16_384 &&
        (typeof process.getuid !== "function" || stat.uid === process.getuid()), "QA_IDENTITY_FILE_NOT_PRIVATE");
      document = JSON.parse(await handle.readFile("utf8"));
    } finally { await handle.close(); }
    sdk.exactFields(document, ["schemaVersion", "kind", "chainId", "publicId", "createdAt", "identities"], "QA custody document");
    ensure(document.schemaVersion === 1 && document.kind === "YNX_TESTNET_QA_IDENTITIES" && document.chainId === "ynx_6423-1" &&
      /^videoqa-identity-[0-9a-f]{24}$/.test(document.publicId) && Array.isArray(document.identities) && document.identities.length === 2,
    "NOT_A_TESTNET_QA_IDENTITY_FILE");
    actors = document.identities.map((item, index) => {
      sdk.exactFields(item, ["role", "account", "accountSecret", "deviceId", "deviceKey", "deviceSecret"], "QA custody identity");
      ensure(item.role === ["owner", "reviewer"][index] && /^[0-9a-f]{64}$/.test(item.accountSecret) &&
        /^[A-Za-z0-9_-]{43}$/.test(item.deviceSecret) && item.deviceId.startsWith(`videoqa-${item.role}-`) &&
        sdk.walletIdentity(item.accountSecret).account === item.account, "QA_IDENTITY_BINDING_MISMATCH");
      const actor = { role: item.role, account: item.account, secret: Buffer.from(item.accountSecret, "hex"),
        deviceId: item.deviceId, deviceKey: item.deviceKey, deviceSecret: Buffer.from(item.deviceSecret, "base64url"), session: null, issuedSessions: [] };
      // The SDK validates the saved device public/private binding before any network call.
      const { request, approval } = requestAndApproval(actor);
      const challenge = sdk.createProductSessionChallenge(registry, request, approval, { challenge: token() });
      sdk.signProductSessionChallenge(challenge, actor.deviceSecret.toString("base64url"));
      return actor;
    });
  }
  ensure(actors[0].account !== actors[1].account, "QA_IDENTITIES_NOT_INDEPENDENT");
  receipt.qaIdentitySecretsPersisted = true;
  receipt.qaIdentityPublicId = document.publicId;
  receipt.qaIdentityFile = options.identity;
  await event("qa-identity-custody", { result: created ? "created-0600" : "reused-0600", publicId: document.publicId,
    sessionOrProofPersisted: false });
}
function requestAndApproval(actor) {
  const now = new Date();
  const request = sdk.createProductSessionRequest(registry, {
    productId: "video", platform: "web", deviceId: actor.deviceId, deviceKey: actor.deviceKey,
    scopes, purpose: `YNX Testnet QA ${actor.role}: repository-owned clip processing and publication`, nonce: token(), state: token(),
  }, now);
  const approval = sdk.signProductSessionApproval(registry, request, {
    accountSecret: actor.secret.toString("hex"), scopes, expiresAt: request.expiresAt,
  }, now);
  const walletURL = sdk.encodeProductSessionWalletURL(registry, request, now);
  const parsedRequest = sdk.parseProductSessionWalletURL(registry, walletURL, now);
  ensure(sdk.canonicalJSON(parsedRequest) === sdk.canonicalJSON(request), "WALLET_REQUEST_ROUNDTRIP_FAILED");
  const returnURL = sdk.createProductSessionReturnURL(registry, request, { result: "approved", approval }, now);
  const returned = sdk.parseProductSessionReturnURL(registry, request, returnURL, now);
  ensure(returned.status === "ready" && sdk.canonicalJSON(returned.approval) === sdk.canonicalJSON(approval), "CALLBACK_ROUNDTRIP_FAILED");
  return { request, approval };
}
async function offlineCheck() {
  const actor = makeActor("offline-check");
  try {
    const { request, approval } = requestAndApproval(actor);
    const challenge = sdk.createProductSessionChallenge(registry, request, approval, { challenge: token() });
    const completion = sdk.signProductSessionChallenge(challenge, actor.deviceSecret.toString("base64url"));
    ensure(completion.challenge.deviceKey === actor.deviceKey && typeof completion.deviceSignature === "string", "DEVICE_SIGNING_FAILED");
    const changedState = new URL(sdk.createProductSessionReturnURL(registry, request, { result: "approved", approval }));
    changedState.searchParams.set("state", token());
    ensure(sdk.parseProductSessionReturnURL(registry, request, changedState.href).status === "callback-mismatch", "CALLBACK_NEGATIVE_CHECK_FAILED");
    await event("offline-sdk-check", { result: "passed", networkRequests: 0,
      checks: ["secp256k1 approval", "exact request and callback roundtrip", "P-256 challenge signing", "wrong callback state rejected"] });
  } finally { actor.secret.fill(0); actor.deviceSecret.fill(0); }
}
async function boundedFetch(url, init = {}, limit = 1_048_576, timeoutMs = 30_000) {
  const target = new URL(url);
  ensure([authOrigin, productOrigin, viewerOrigin].includes(target.origin) && !target.username && !target.password, "UNEXPECTED_NETWORK_TARGET");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal });
    const declared = response.headers.get("content-length");
    ensure(declared === null || (/^\d+$/.test(declared) && Number(declared) <= limit), "RESPONSE_TOO_LARGE");
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body ?? []) {
      length += chunk.length;
      ensure(length <= limit, "RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    return { status: response.status, headers: response.headers, bytes,
      text: async () => bytes.toString("utf8") };
  } catch (error) {
    if (error?.code) throw error;
    throw Object.assign(new Error("NETWORK_UNAVAILABLE"), { code: "NETWORK_UNAVAILABLE" });
  } finally { clearTimeout(timeout); }
}
function jsonBody(response) {
  ensure(/^application\/json\b/i.test(response.headers.get("content-type") ?? ""), "RESPONSE_NOT_JSON");
  try { return JSON.parse(response.bytes.toString("utf8")); }
  catch { throw Object.assign(new Error("INVALID_JSON_RESPONSE"), { code: "INVALID_JSON_RESPONSE" }); }
}
async function probe() {
  for (const [label, url] of [["auth-version", `${authOrigin}/version`], ["video-health", `${apiOrigin}/health`],
    ["video-version", `${apiOrigin}/version`], ["anonymous-catalog-before", `${viewerOrigin}/video/api/v1/videos`]]) {
    currentStep = label;
    const result = await boundedFetch(url);
    await event(label, { url, status: result.status, bytes: result.bytes.length, sha256: hash(result.bytes) });
    ensure(result.status === 200, "PUBLIC_PREFLIGHT_FAILED");
    jsonBody(result);
  }
}
function adapter() {
  return new sdk.ProductSessionGatewayFetchAdapter({ endpoint: authOrigin, timeoutMs: 30_000,
    // These capabilities remain false: this CLI has no installed-Wallet evidence.
    walletInstalled: () => false, schemeRegistered: () => false,
    fetch: (url, init) => boundedFetch(url, { ...init, headers: { ...init.headers, Origin: productOrigin } }),
  });
}
function freshProof(actor, path, body, session = actor.session) {
  const now = new Date();
  return sdk.createProductSessionProofV2(session, {
    method: "POST", path, bodyDigest: sdk.httpBodyDigest(sdk.canonicalJSON(body)), nonce: token(),
    issuedAt: now.toISOString(), expiresAt: new Date(Math.min(now.getTime() + 30_000, Date.parse(session.expiresAt))).toISOString(),
  }, actor.deviceSecret.toString("base64url"));
}
async function authorize(actor) {
  if (actor.session && Date.parse(actor.session.expiresAt) - Date.now() > 45_000) return;
  currentStep = `${actor.role}-session-issuance`;
  const gateway = adapter();
  const { request, approval } = requestAndApproval(actor);
  const challenge = sdk.parseProductSessionChallenge(await gateway.challenge({ requestId: requestId(), request, approval }));
  const expected = sdk.createProductSessionChallenge(registry, request, approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
  ensure(sdk.canonicalJSON(challenge) === sdk.canonicalJSON(expected) && challenge.expiresAt > new Date().toISOString(), "CHALLENGE_BINDING_MISMATCH");
  const completion = sdk.signProductSessionChallenge(challenge, actor.deviceSecret.toString("base64url"));
  const session = sdk.parseProductSession(await gateway.complete({ requestId: requestId(), request, approval, completion }));
  for (const key of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "deviceId", "deviceKey", "nonce", "state"]) {
    ensure(session[key] === request[key], "SESSION_BINDING_MISMATCH");
  }
  ensure(session.account === actor.account && sdk.canonicalJSON(session.scopes) === sdk.canonicalJSON(scopes) &&
    session.sessionBinding === sdk.digestHex("YNX_PRODUCT_SESSION_BINDING_V2", challenge) &&
    session.requestDigest === challenge.requestDigest && session.approvalDigest === challenge.approvalDigest &&
    session.expiresAt === challenge.sessionExpiresAt && session.expiresAt > new Date().toISOString(), "SESSION_BINDING_MISMATCH");
  actor.issuedSessions.push(session);
  actor.session = session;
  const proof = freshProof(actor, "/v2/product-sessions/introspect", { requiredScopes: scopes });
  const result = await gateway.introspect({ requestId: requestId(), sessionBinding: session.sessionBinding, requiredScopes: scopes, proof });
  ensure(result.active === true && sdk.canonicalJSON(sdk.parseProductSession(result.session)) === sdk.canonicalJSON(session), "SESSION_NOT_CONFIRMED");
  await event(currentStep, { account: actor.account, result: "real-gateway-confirmed", expiresAt: session.expiresAt });
}
function routeScope(method, path) {
  if (["/history", "/playlists", "/subscriptions", "/subscription", "/watch"].some(part => path.includes(part))) return "video:library";
  return method === "GET" || method === "HEAD" ? "video:playback" : "video:account";
}
async function business(actor, step, method, path, body, expectedStatus = 200) {
  await authorize(actor);
  currentStep = step;
  ensure(/^\/v1\/[A-Za-z0-9_/-]+$/.test(path), "INVALID_BUSINESS_PATH");
  const scope = routeScope(method, path);
  ensure(scopes.includes(scope), "UNAPPROVED_QA_SCOPE");
  const proof = freshProof(actor, "/v2/product-sessions/introspect", { requiredScopes: [scope] });
  const headers = { Accept: "application/json", Origin: productOrigin,
    "X-YNX-Product-Session-Proof-V2": sdk.encodeProductSessionGatewayProofHeaderV2(proof) };
  if (method !== "GET") headers["Idempotency-Key"] = `${runId}:${step}`;
  const isMultipart = body instanceof FormData;
  if (body !== undefined && !isMultipart) headers["Content-Type"] = "application/json";
  await event(`${step}-request`, { actor: actor.role, method, path, requiredScope: scope,
    ...(method !== "GET" ? { idempotencyKey: headers["Idempotency-Key"] } : {}) });
  const response = await boundedFetch(`${apiOrigin}${path}`, { method, headers,
    ...(body === undefined ? {} : { body: isMultipart ? body : sdk.canonicalJSON(body) }) }, 1_048_576, isMultipart ? 300_000 : 30_000);
  await event(`${step}-response`, { status: response.status, bytes: response.bytes.length, sha256: hash(response.bytes) });
  ensure(response.status === expectedStatus, "BUSINESS_HTTP_REJECTED");
  return jsonBody(response);
}
async function revokeSessions() {
  for (const actor of actors) {
    for (const session of actor.issuedSessions) {
      if (Date.parse(session.expiresAt) <= Date.now()) continue;
      try {
        const proof = freshProof(actor, "/v2/product-sessions/revoke", {}, session);
        const result = await adapter().revoke({ requestId: requestId(), sessionBinding: session.sessionBinding, proof });
        ensure(result.revoked === session.sessionBinding, "REVOKE_NOT_CONFIRMED");
        await event("session-revocation", { actor: actor.role, result: "confirmed" });
      } catch (error) { await event("session-revocation", { actor: actor.role, result: "unconfirmed", code: safeCode(error), expiresAt: session.expiresAt }); }
    }
    actor.secret.fill(0);
    actor.deviceSecret.fill(0);
    actor.session = null;
    actor.issuedSessions.length = 0;
  }
}
async function execute() {
  receipt.networkWrites = true;
  receiptPath = resolve(root, `apps/video/audit/qa-library-${runId}.json`);
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2)+'\n', { mode:0o600, flag:'wx' });
  await loadOrCreateQAIdentities();
  const [owner, reviewer] = actors;
  const videoId = 'vid_037cc8f97abd9a6dff7a4e74';
  const channelId = 'chn_ed97005f197d918ffd712e60';
  await authorize(owner); await authorize(reviewer);
  const video = await business(owner,'read-owned-qa-public-video','GET','/v1/videos/'+videoId);
  ensure(video.sha256 === expectedMediaHash && video.channel_id === channelId && video.owner === owner.account && video.visibility === 'public', 'QA_VIDEO_IDENTITY_MISMATCH');
  receipt.qaAccounts = {owner:owner.account, other:reviewer.account};
  const initial = await business(owner,'initial-subscriptions','GET','/v1/subscriptions');
  const originallySubscribed = initial.some(item => (item.ID ?? item.id) === channelId);
  let playlistId = null;
  try {
    const list = await business(owner,'create-qa-playlist','POST','/v1/playlists',{Name:'Testnet QA library check '+runId});
    playlistId = objectId(list.ID ?? list.id); receipt.playlistId = playlistId;
    ensure((list.Owner ?? list.owner) === owner.account,'QA_PLAYLIST_OWNER_MISMATCH');
    await business(owner,'save-qa-video','POST','/v1/playlists/'+playlistId+'/videos',{video_id:videoId});
    const lists = await business(owner,'read-saved-playlist','GET','/v1/playlists');
    ensure(lists.find(item=>(item.ID??item.id)===playlistId)?.VideoIDs?.includes(videoId),'QA_SAVE_NOT_PERSISTED');
    await business(reviewer,'reject-other-account-delete','DELETE','/v1/playlists/'+playlistId,undefined,403);
    await business(reviewer,'reject-other-account-remove','DELETE','/v1/playlists/'+playlistId+'/videos/'+videoId,undefined,403);
    await business(owner,'remove-saved-video','DELETE','/v1/playlists/'+playlistId+'/videos/'+videoId);
    const emptied = await business(owner,'read-removed-video','GET','/v1/playlists');
    ensure((emptied.find(item=>(item.ID??item.id)===playlistId)?.VideoIDs??[]).length===0,'QA_REMOVE_NOT_PERSISTED');
    await business(owner,'delete-qa-playlist','DELETE','/v1/playlists/'+playlistId);
    const deleted = await business(owner,'read-deleted-playlist','GET','/v1/playlists');
    ensure(!deleted.some(item=>(item.ID??item.id)===playlistId),'QA_DELETE_NOT_PERSISTED'); playlistId=null;
    if(!originallySubscribed) await business(owner,'subscribe-qa-channel','POST','/v1/channels/'+channelId+'/subscription');
    const subscribed = await business(owner,'read-subscribed','GET','/v1/subscriptions');
    ensure(subscribed.some(item=>(item.ID??item.id)===channelId),'QA_SUBSCRIBE_NOT_PERSISTED');
    await business(owner,'unsubscribe-qa-channel','DELETE','/v1/channels/'+channelId+'/subscription');
    const unsubscribed = await business(owner,'read-unsubscribed','GET','/v1/subscriptions');
    ensure(!unsubscribed.some(item=>(item.ID??item.id)===channelId),'QA_UNSUBSCRIBE_NOT_PERSISTED');
    await business(owner,'read-private-history','GET','/v1/history');
    const original = await boundedFetch(viewerOrigin+'/video/api/v1/videos/'+videoId);
    ensure(original.status===200 && jsonBody(original).sha256===expectedMediaHash,'QA_LIBRARY_DELETED_SOURCE');
    receipt.complete = true;
    await event('video-library-workflow-confirmed',{videoId,channelId,sourceUnaffected:true,crossAccountRejected:true,browserVerified:false,installedWalletVerified:false});
  } finally {
    if(playlistId) try {await business(owner,'cleanup-own-qa-playlist','DELETE','/v1/playlists/'+playlistId);}catch(error){await event('qa-playlist-cleanup-unconfirmed',{playlistId,code:safeCode(error)});}
    try {
      const remaining = await business(owner,'cleanup-read-subscriptions','GET','/v1/subscriptions');
      const isSubscribed = remaining.some(item=>(item.ID??item.id)===channelId);
      if(isSubscribed!==originallySubscribed) await business(owner,'restore-initial-qa-subscription',originallySubscribed?'POST':'DELETE','/v1/channels/'+channelId+'/subscription');
    }catch(error){await event('qa-subscription-cleanup-unconfirmed',{code:safeCode(error)});}
  }
}
try {
  const media = await loadInputs();
  if (media !== null) {
    if (options.check || options.execute) await offlineCheck();
    if (options.probe || options.execute) await probe();
    if (options.execute) await execute(media);
  }
} catch (error) {
  receipt.complete = false;
  receipt.failure = { step: currentStep, code: safeCode(error),
    action: "Stop and inspect the receipt/runtime. Do not blindly rerun after a mutation or uncertain network result." };
  process.exitCode = 1;
  await event("failed", receipt.failure);
} finally {
  if (options.execute && actors.length) await revokeSessions();
  receipt.finishedAt = new Date().toISOString();
  if (receiptPath) {
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ receiptPath, complete: receipt.complete })}\n`);
  }
}
