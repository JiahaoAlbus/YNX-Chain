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
const productOrigin = "https://creator.ynxweb4.com";
const viewerOrigin = "https://video.ynxweb4.com";
const apiOrigin = `${productOrigin}/video/api`;
const mediaPath = resolve(root, "internal/video/testdata/ynx-owned-test.mp4");
const expectedMediaHash = "be414db1d01558b11c7592b7d4dc69d0fee8da158997dc477e2fdaf6b9e3ee39";
const scopes = ["creator:account", "creator:publish"];
const args = process.argv.slice(2);
const options = { execute: false, check: false, probe: false,
  sdk: resolve(root, "apps/video/.qa-runtime/sdk-b3e4b5269"), registry: null, identity: null };
const privateDirectory = resolve(root, "apps/video/.qa-private");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const requestId = () => `req_videoqa_${randomBytes(16).toString("hex")}`;
const runId = `videoqa-${new Date().toISOString().replace(/[^0-9]/g, "")}-${randomBytes(4).toString("hex")}`;
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
      process.stdout.write("Usage: node apps/video/scripts/qa-product-session-workflow.mjs [--check] [--probe] [--execute --identity-file apps/video/.qa-private/NAME.json] [--sdk-dir PATH] [--registry PATH]\nDefault: local plan only. --check: offline SDK signing/callback checks. --probe: public GETs only. --execute requires explicit QA identity custody, issues real sessions and publishes one labeled owned Testnet clip. Never retries a business mutation automatically.\n");
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
  const binding = sdk.productPlatformBinding(registry, "creator-studio", "web");
  ensure(binding.chainId === "ynx_6423-1" && binding.clientId === "ynx-creator-studio-web-v1" &&
    binding.applicationId === "com.ynxweb4.creator-studio.web" && binding.origin === productOrigin &&
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
    operations: ["public health/version GET", "two real v2 session issuances", "create QA channel",
      "invite moderator", "accept invite as second account", "upload owned clip and real processing",
      "declare source-bound rights", "submit review", "independent moderator review", "publish public",
      "anonymous catalog/detail GET and original media hash", "revoke QA sessions"],
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
    productId: "creator-studio", platform: "web", deviceId: actor.deviceId, deviceKey: actor.deviceKey,
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
  if (["/payout-intents", "/revenue", "/disputes"].some(part => path.includes(part))) return "creator:revenue";
  return method === "GET" || method === "HEAD" ? "creator:account" : "creator:publish";
}
async function business(actor, step, method, path, body) {
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
  ensure(response.status === 200, "BUSINESS_HTTP_REJECTED");
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
async function execute(media) {
  receipt.networkWrites = true;
  receiptPath = resolve(root, `apps/video/audit/qa-workflow-${runId}.json`);
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await loadOrCreateQAIdentities();
  const [owner, reviewer] = actors;
  ensure(owner.account !== reviewer.account, "QA_IDENTITIES_NOT_INDEPENDENT");
  receipt.qaAccounts = { owner: owner.account, reviewer: reviewer.account };
  await authorize(owner);
  await authorize(reviewer);
  const channel = await business(owner, "create-channel", "POST", "/v1/channels", {
    Handle: `testnet-qa-${randomBytes(6).toString("hex")}`, Name: `YNX Testnet QA ${new Date().toISOString().slice(0, 10)}`,
  });
  const channelId = objectId(channel.ID);
  ensure(channel.Owner === owner.account, "CHANNEL_OWNER_MISMATCH");
  receipt.channelId = channelId;
  const team = await business(owner, "read-qa-team", "GET", `/v1/channels/${channelId}/team`);
  const activeReviewer = team.members?.find(item => item.account === reviewer.account && item.state === "active");
  if (activeReviewer) ensure(activeReviewer.role === "moderator", "EXISTING_QA_ROLE_MISMATCH");
  else {
    const invite = team.invites?.find(item => item.account === reviewer.account && item.role === "moderator" &&
      item.state === "pending" && Date.parse(item.expires_at) > Date.now()) ??
      await business(owner, "invite-moderator", "POST", `/v1/channels/${channelId}/team/invites`, {
        account: reviewer.account, role: "moderator", expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    const inviteId = objectId(invite.id);
    ensure(invite.account === reviewer.account && invite.channel_id === channelId && invite.role === "moderator" && invite.state === "pending", "INVITE_BINDING_MISMATCH");
    const member = await business(reviewer, "accept-invite", "POST", `/v1/team/invites/${inviteId}/accept`);
    ensure(member.account === reviewer.account && member.channel_id === channelId && member.role === "moderator" && member.state === "active", "TEAM_MEMBERSHIP_NOT_ACTIVE");
  }
  const title = `YNX Testnet QA — owned processing demo ${new Date().toISOString().slice(0, 10)}`;
  const identityTag = `QA identity ${receipt.qaIdentityPublicId}.`;
  const description = `Repository-owned synthetic blue video and 642 Hz tone. Testnet QA only; not user content or a business adoption metric. ${identityTag} QA run ${runId}.`;
  const form = new FormData();
  for (const [key, value] of Object.entries({ channel_id: channelId, title, description, size: String(media.length),
    sha256: expectedMediaHash, owned_content_declaration: "true", rights_basis: "owned",
    rights_source: "YNX-Chain internal/video/testdata/ynx-owned-test.mp4; generated solid blue and synthetic 642 Hz tone",
    rights_license: "Repository-owned YNX Video processing Testnet QA; project owner authorized public QA demonstration",
    rights_territories: "WORLDWIDE", rights_evidence_sha256: receipt.rightsEvidenceSHA256 })) form.set(key, value);
  form.set("media", new Blob([media], { type: "video/mp4" }), "ynx-owned-test.mp4");
  const snapshot = await business(owner, "read-qa-studio", "GET", "/v1/studio");
  const priorVideos = (snapshot.videos ?? []).filter(item => item.owner === owner.account && item.channel_id === channelId && item.description?.includes(identityTag));
  ensure(priorVideos.length <= 1, "MULTIPLE_QA_VIDEOS_REQUIRE_REVIEW");
  let video = priorVideos[0] ?? await business(owner, "upload-owned-clip", "POST", "/v1/uploads", form);
  const videoId = objectId(video.id);
  receipt.videoId = videoId;
  ensure(video.owner === owner.account && video.channel_id === channelId && video.sha256 === expectedMediaHash, "UPLOADED_VIDEO_BINDING_MISMATCH");
  const deadline = Date.now() + 120_000;
  while (!["ready", "published"].includes(video.status) && Date.now() < deadline) {
    ensure(["scanning", "transcoding"].includes(video.status), "REAL_PROCESSING_FAILED");
    await event("processing-pending", { videoId, status: video.status });
    await delay(5000);
    video = await business(owner, "processing-readback", "GET", `/v1/videos/${videoId}`);
  }
  ensure(["ready", "published"].includes(video.status) && video.probe?.width > 0 && video.probe?.height > 0 && video.probe?.duration_seconds > 0 &&
    video.variants?.some(variant => variant.name !== "original-fallback" && /^[0-9a-f]{64}$/.test(variant.sha256)), "REAL_PROCESSING_NOT_READY");
  await event("processing-confirmed", { videoId, status: video.status, sourceSHA256: video.sha256,
    width: video.probe.width, height: video.probe.height, durationSeconds: video.probe.duration_seconds,
    variantCount: video.variants.length });
  const existingRights = (snapshot.rights ?? []).find(item => item.id === video.rights_declaration_id);
  const rights = existingRights ?? await business(owner, "declare-rights", "POST", `/v1/videos/${videoId}/rights`, {
    basis: "owned", license_reference: "Repository-owned processing media; project-owner-authorized Testnet QA publication",
    territories: ["WORLDWIDE"], starts_at: null, ends_at: null, exclusive: false,
    contributor_splits: [{ account: owner.account, basis_points: 10000 }],
    evidence_sha256: receipt.rightsEvidenceSHA256, source_sha256: expectedMediaHash,
  });
  ensure(["declared", "verified"].includes(rights.state) && rights.source_sha256 === expectedMediaHash && rights.video_id === videoId, "RIGHTS_DECLARATION_NOT_ACTIVE");
  receipt.rightsDeclarationId = objectId(rights.id);
  if (["draft", "rejected", "unpublished"].includes(video.workflow_state)) {
    video = await business(owner, "submit-review", "POST", `/v1/videos/${videoId}/submit-review`);
  }
  if (video.workflow_state === "in_review") {
  ensure(video.submitted_by === owner.account, "REVIEW_NOT_SUBMITTED");
  const reviewView = await business(reviewer, "reviewer-private-readback", "GET", `/v1/videos/${videoId}`);
  ensure(reviewView.id === videoId && reviewView.sha256 === expectedMediaHash && reviewView.status === "ready" &&
    reviewView.workflow_state === "in_review" && reviewView.submitted_by === owner.account &&
    reviewView.rights_declaration_id === rights.id && reviewView.probe?.width > 0 && reviewView.variants?.length > 1,
  "REVIEWER_PRIVATE_READBACK_FAILED");
  const reviewed = await business(reviewer, "independent-review", "POST", `/v1/videos/${videoId}/review-publication`, {
    approved: true, reason: "Independent QA account programmatically checked source checksum, rights linkage, and processing metadata for the repository-owned Testnet clip. Automated QA review, not human visual or commercial rights verification.",
  });
  ensure(reviewed.workflow_state === "approved" && reviewed.reviewed_by === reviewer.account && reviewed.submitted_by === owner.account, "INDEPENDENT_REVIEW_NOT_CONFIRMED");
  video = reviewed;
  }
  ensure(["approved", "published"].includes(video.workflow_state) && video.reviewed_by === reviewer.account && video.submitted_by === owner.account, "QA_REVIEW_HISTORY_MISMATCH");
  if (video.workflow_state !== "published" || video.visibility !== "public") {
    await business(owner, "publish-public", "POST", `/v1/videos/${videoId}/publish`, { visibility: "public" });
  }
  currentStep = "anonymous-public-readback";
  const detailResponse = await boundedFetch(`${viewerOrigin}/video/api/v1/videos/${videoId}`);
  ensure(detailResponse.status === 200, "ANONYMOUS_VIDEO_UNAVAILABLE");
  const publicVideo = jsonBody(detailResponse);
  ensure(publicVideo.id === videoId && publicVideo.visibility === "public" && publicVideo.status === "published" && publicVideo.workflow_state === "published" &&
    publicVideo.sha256 === expectedMediaHash, "PUBLIC_VIDEO_BINDING_MISMATCH");
  const catalogResponse = await boundedFetch(`${viewerOrigin}/video/api/v1/videos`);
  ensure(catalogResponse.status === 200, "ANONYMOUS_CATALOG_UNAVAILABLE");
  const catalog = jsonBody(catalogResponse);
  ensure(Array.isArray(catalog) && catalog.some(item => item.id === videoId), "PUBLIC_VIDEO_NOT_DISCOVERABLE");
  const fallback = publicVideo.variants?.find(item => item.name === "original-fallback");
  ensure(fallback?.object_key === `${videoId}/original`, "ORIGINAL_MEDIA_LINEAGE_MISMATCH");
  const mediaURL = `${viewerOrigin}/video/api/media/${fallback.object_key}`;
  const downloaded = await boundedFetch(mediaURL, { headers: { Accept: "video/mp4" } }, media.length + 1);
  ensure(downloaded.status === 200 && downloaded.bytes.length === media.length && hash(downloaded.bytes) === expectedMediaHash, "PUBLIC_MEDIA_HASH_MISMATCH");
  receipt.complete = true;
  receipt.viewerURL = `${viewerOrigin}/?video=${encodeURIComponent(videoId)}`;
  receipt.mediaURL = mediaURL;
  await event("public-workflow-confirmed", { channelId, videoId, viewerURL: receipt.viewerURL, mediaURL,
    anonymousCatalog: true, anonymousSourceHashMatched: true, sourceSHA256: expectedMediaHash,
    browserPlaybackVerified: false, installedWalletVerified: false });
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
