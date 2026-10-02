import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { CENTRAL_IDENTITY, createCentralIdentityVerifier, fault } from "./central-identity.mjs";
import { createCentralFamily } from "./central-family.mjs";

const PARENT = "https://developer.ynxweb4.com", COOKIE = "__Host-ynx_developer_identity", TRANSACTION = "__Host-ynx_developer_pkce";
const random = () => randomBytes(32).toString("base64url"), hash = value => createHash("sha256").update(value).digest("hex");
const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));

// Product-owned consumer: PKCE verifier and central grants never enter workspace
// processes, public URLs, JavaScript storage, logs or extension-host environments.
export async function createDeveloperSSO({ filename, keyPath, workspaceStore, guestOwnerForRequest,
  fetchImpl = globalThis.fetch, coreSessionInfo, onSignOut, familyKeyPath, familyKeyId, now = Date.now } = {}) {
  let key;
  try {
    const file = await open(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error("Developer sealed identity key must be private to the backend owner.");
      key = await file.readFile();
    } finally { await file.close(); }
  }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = await lstat(dirname(keyPath));
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid() || (parent.mode & 0o022)) throw new Error("Developer identity state directory is not protected.");
    key = randomBytes(32); const file = await open(keyPath, "wx", 0o600);
    try { await file.writeFile(key); await file.sync(); } finally { await file.close(); }
    const directory = await open(dirname(keyPath), "r"); try { await directory.sync(); } finally { await directory.close(); }
  }
  if (key.length !== 32) throw new Error("Developer sealed identity key must contain exactly 32 bytes.");
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS developer_identity_records(kind TEXT NOT NULL,id_hash TEXT NOT NULL,sealed TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(kind,id_hash)); CREATE TABLE IF NOT EXISTS developer_identity_bindings(owner TEXT PRIMARY KEY,workspace_owner TEXT NOT NULL);");
  function seal(value, kind, id) {
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(`${kind}:${hash(id)}`));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString("base64");
  }
  function store(kind, id, value, expires) {
    db.prepare("INSERT INTO developer_identity_records(kind,id_hash,sealed,expires_at) VALUES(?,?,?,?)").run(kind, hash(id), seal(value, kind, id), expires);
  }
  function retrieve(kind, id, consume = false) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id || "")) return null;
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT * FROM developer_identity_records WHERE kind=? AND id_hash=?").get(kind, hash(id));
      if (!row || row.consumed || row.expires_at <= now()) { db.exec("COMMIT"); return null; }
      const raw = Buffer.from(row.sealed, "base64"), decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      decipher.setAAD(Buffer.from(`${kind}:${hash(id)}`)); decipher.setAuthTag(raw.subarray(12, 28));
      const value = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString());
      if (consume) db.prepare("UPDATE developer_identity_records SET consumed=1 WHERE kind=? AND id_hash=?").run(kind, hash(id));
      db.exec("COMMIT"); return value;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function decode(kind, id, row) {
    const raw = Buffer.from(row.sealed, "base64"), decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${kind}:${hash(id)}`)); decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString());
  }
  const familyRecords = {
    get(kind, id) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(id || "")) return null;
      const row = db.prepare("SELECT * FROM developer_identity_records WHERE kind=? AND id_hash=?").get(kind, hash(id));
      return row && row.expires_at > now() ? decode(kind, id, row) : null;
    },
    put(kind, id, revision, value, expires) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM developer_identity_records WHERE kind IN ('finite-intent','finite-family') AND expires_at<=?").run(now());
        if (!familyRecords.get(kind, id) && db.prepare("SELECT COUNT(*) AS count FROM developer_identity_records WHERE kind IN ('finite-intent','finite-family')").get().count >= 8192) throw fault("Identity capacity is temporarily unavailable.", "core_identity_unavailable", 503);
        const old = familyRecords.get(kind, id);
        if ((old?.revision ?? null) !== revision) throw fault("Identity was changed by another operation.", "core_identity_conflict", 409);
        db.prepare("INSERT INTO developer_identity_records(kind,id_hash,sealed,expires_at) VALUES(?,?,?,?) ON CONFLICT(kind,id_hash) DO UPDATE SET sealed=excluded.sealed,expires_at=excluded.expires_at").run(kind, hash(id), seal(value, kind, id), expires);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    install(intentID, revision, intent, id, family, expires) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = familyRecords.get("finite-intent", intentID);
        if (!current || canonical(current.input) !== canonical(intent.input)) throw fault("Identity intent was changed.", "core_identity_conflict", 409);
        if (current.familyID) { db.exec("COMMIT"); return current.familyID; }
        // Cancellation in another backend process is read in this same SQLite
        // transaction. Keep the remote result as a fenced revoke target.
        if (current.canceled || current.expiresAt <= now()) family = { ...family, fenced: true, revocationPending: true };
        intent = { ...current, familyID: id, revision: current.revision + 1 };
        store("finite-family", id, family, expires);
        db.prepare("UPDATE developer_identity_records SET sealed=?,expires_at=? WHERE kind='finite-intent' AND id_hash=?").run(seal(intent, "finite-intent", intentID), expires, hash(intentID));
        db.exec("COMMIT"); return id;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  if (Boolean(familyKeyPath) !== Boolean(familyKeyId)) throw fault("Confidential Developer identity configuration is incomplete.", "core_identity_unavailable", 503);
  const family = familyKeyPath ? await createCentralFamily({ records: familyRecords, keyPath: familyKeyPath, keyId: familyKeyId, fetchImpl, now }) : null;
  function cookie(request, name) { return String(request.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1); }
  function host(request) { return String(request.headers.host || ""); }
  const grantForReference = async id => {
    let grant = retrieve("session", id);
    if (!grant) return null;
    const reference = grant.identityReference || id;
    const parent = retrieve("session", reference);
    if (!parent || parent.subject !== grant.subject || parent.account !== grant.account || parent.generation !== grant.generation) return null;
    if (parent.familyID) {
      if (!family) throw fault("Finite Developer identity is not configured.", "core_identity_unavailable", 503);
      const fresh = await family.Resolve(parent.familyID);
      if (fresh.identity.subject !== parent.subject || fresh.identity.account !== parent.account || fresh.identity.generation !== parent.generation || !retrieve("session", reference) || !retrieve("session", id)) return null;
      grant = { ...grant, grantToken: fresh.grantToken, expiresAt: fresh.expiresAt, familyAbsoluteExpiresAt: fresh.absoluteExpiresAt, familyCurrent: fresh.isCurrent };
    }
    return { ...grant, identityReference: reference, isCurrent: () => {
      const current = retrieve("session", id);
      const original = retrieve("session", reference);
      return Boolean((!grant.familyCurrent || grant.familyCurrent()) && current && original && original.subject === grant.subject && original.account === grant.account && original.generation === grant.generation &&
        current.subject === grant.subject && current.account === grant.account && current.generation === grant.generation &&
        current.allowedHost === grant.allowedHost && current.allowedCoreSession === grant.allowedCoreSession);
    } };
  };
  const grantForRequest = async request => {
    const grant = await grantForReference(cookie(request, COOKIE));
    if (!grant || grant.allowedHost !== host(request)) return null;
    return grant;
  };
  const workspaceBinding = async ({ owner }) => {
    const row = db.prepare("SELECT * FROM developer_identity_bindings WHERE owner=?").get(owner);
    return row ? { owner, workspaceOwner: row.workspace_owner } : null;
  };
  const verifyIdentity = createCentralIdentityVerifier({ grantForRequest, grantForReference, workspaceBinding, fetchImpl, now });

  async function backend(path, value) {
    const response = await fetchImpl(`https://wallet-auth.ynxweb4.com/v2/browser-sessions/${path}`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: canonical(value),
      redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw fault("Wallet sign-in was rejected or expired. Try the normal sign-in flow again.", "developer_sso_rejected", 401);
    return response.json();
  }
  function setCookie(name, id, maxAge) { return `${name}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`; }
  function redirect(response, location, cookies = []) { response.writeHead(303, { location, "set-cookie": cookies, "cache-control": "no-store", "referrer-policy": "no-referrer" }); response.end(); }
  function parentOnly(request) { if (host(request) !== new URL(PARENT).host) throw fault("Developer identity request host did not match.", "developer_sso_origin_invalid", 403); }
  function sameOrigin(request) { parentOnly(request); if (request.headers.origin !== PARENT || (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin")) throw fault("Developer identity operation requires same-origin review.", "developer_sso_origin_invalid", 403); }

  async function handler(request, response) {
    const url = new URL(request.url, PARENT), path = url.pathname;
    if (!["/sso/start", "/sso/callback", "/sso/core-open", "/sso/core-admit", "/runtime/identity", "/runtime/identity/activity", "/runtime/identity/import", "/runtime/identity/logout"].includes(path)) return false;
    try {
      if (path === "/sso/start" && request.method === "GET") {
        parentOnly(request);
        const state = random(), verifier = random(), transaction = random();
        const priorTransaction = cookie(request, TRANSACTION), priorIntent = retrieve("pkce", priorTransaction);
        if (priorIntent) {
          db.prepare("UPDATE developer_identity_records SET consumed=1 WHERE kind='pkce' AND id_hash=?").run(hash(priorTransaction));
          if (priorIntent.intentID) await family.Logout({ intentID: priorIntent.intentID });
        }
        const previous = retrieve("session", cookie(request, COOKIE));
        const intentID = family ? await family.Prepare({ state, previousFamilyID: previous?.familyID || "" }) : null;
        store("pkce", transaction, { state, verifier, ...(intentID ? { intentID } : {}) }, now() + 120000);
        const destination = new URL("https://wallet-auth.ynxweb4.com/v2/browser-sessions/authorize");
        for (const [name, value] of Object.entries({ clientId: CENTRAL_IDENTITY.clientId, origin: PARENT,
          redirectUri: CENTRAL_IDENTITY.callback, state, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256" })) destination.searchParams.set(name, value);
        redirect(response, destination.href, [setCookie(TRANSACTION, transaction, 120)]); return true;
      }
      if (path === "/sso/callback" && request.method === "GET") {
        parentOnly(request);
        if ([...url.searchParams].length !== new Set(url.searchParams.keys()).size || [...url.searchParams.keys()].some(name => !["state", "code", "error"].includes(name))) throw fault("Wallet callback fields are invalid.", "developer_sso_callback_invalid", 400);
        const transaction = cookie(request, TRANSACTION), pkce = retrieve("pkce", transaction);
        if (!pkce || pkce.state !== url.searchParams.get("state")) throw fault("Wallet callback state expired or did not match this browser.", "developer_sso_state_invalid", 401);
        if (url.searchParams.has("error")) { if (pkce.intentID) await family.Logout({ intentID: pkce.intentID }); retrieve("pkce", transaction, true); redirect(response, "/", [setCookie(TRANSACTION, "", 0)]); return true; }
        const result = pkce.intentID ? await family.Redeem({ code: url.searchParams.get("code"), state: pkce.state, codeVerifier: pkce.verifier, intentID: pkce.intentID }) : await backend("token", { clientId: CENTRAL_IDENTITY.clientId, origin: PARENT,
          redirectUri: CENTRAL_IDENTITY.callback, code: url.searchParams.get("code"), state: pkce.state, codeVerifier: pkce.verifier });
        const expires = Math.min(Date.parse(result.absoluteExpiresAt || result.expiresAt), Date.parse(result.identity?.expiresAt));
        if (typeof result.grantToken !== "string" || result.grantToken.length < 32 || result.audience !== CENTRAL_IDENTITY.audience ||
          JSON.stringify(result.scopes) !== '["identity:read"]' || !Number.isFinite(expires) || expires <= now() ||
          typeof result.identity?.subject !== "string" || typeof result.identity.account !== "string" || !Number.isSafeInteger(result.identity.generation))
          throw fault("Wallet grant did not match the Developer identity contract.", "developer_sso_grant_invalid", 401);
        const owner = createHash("sha256").update(`YNX_DEVELOPER_IDENTITY_V1\n${CENTRAL_IDENTITY.audience}\n${result.identity.subject}`).digest("hex");
        // New Wallet-owned space, never implicit adoption of the current guest.
        const id = random();
        db.exec("BEGIN IMMEDIATE");
        try {
          const pending = db.prepare("SELECT * FROM developer_identity_records WHERE kind='pkce' AND id_hash=?").get(hash(transaction));
          if (!pending || pending.consumed || pending.expires_at <= now() || (result.isCurrent && !result.isCurrent())) throw fault("Sign-in was canceled by this browser.", "developer_sso_state_invalid", 401);
          db.prepare("INSERT OR IGNORE INTO developer_identity_bindings VALUES(?,?)").run(owner, owner);
          store("session", id, { grantToken: result.grantToken, ...result.identity, ...(result.familyID ? { familyID: result.familyID, csrf: random(), absoluteExpiresAt: result.absoluteExpiresAt } : {}), allowedHost: new URL(PARENT).host }, expires);
          db.prepare("UPDATE developer_identity_records SET consumed=1 WHERE kind='pkce' AND id_hash=?").run(hash(transaction));
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); if (result.familyID) await family.Logout({ familyID: result.familyID, intentID: pkce.intentID }); throw error; }
        redirect(response, "/", [setCookie(COOKIE, id, Math.floor((expires - now()) / 1000)), setCookie(TRANSACTION, "", 0)]); return true;
      }
      if (path === "/runtime/identity" && request.method === "GET") {
        parentOnly(request); const id = await verifyIdentity(request);
        const grant = await grantForRequest(request);
        json(response, 200, { connected: true, account: id.account, generation: id.generation, expiresAt: id.expiresAt, permissions: ["identity:read"], ...(grant?.csrf ? { csrf: grant.csrf } : {}) }); return true;
      }
      if (path === "/runtime/identity/import" && request.method === "POST") {
        sameOrigin(request); const id = await verifyIdentity(request), input = await bodyJSON(request), guest = guestOwnerForRequest(request);
        if (!guest || !/^[A-Za-z0-9_-]{1,160}$/.test(input.projectId || "") || input.approval !== "copy-guest-project-once" || !/^[a-f0-9-]{36}$/.test(input.approvalId || ""))
          throw fault("Review copying this saved guest project into the current Wallet workspace first.", "developer_import_approval_required", 403);
        const original = workspaceStore.get(guest, input.projectId);
        if (!original || original.revision !== input.expectedGuestRevision) throw fault("Guest project changed. Save and review the copy again.", "revision_conflict", 409);
        if (workspaceStore.get(id.workspaceOwner, input.projectId)) throw fault("This Wallet already has this project. Existing files are preserved.", "developer_import_exists", 409);
        const { revision, updatedAt, ...payload } = original;
        const saved = workspaceStore.put(id.workspaceOwner, input.projectId, { expectedRevision: 0, idempotencyKey: `identity-copy-${input.approvalId}`, payload });
        json(response, 201, { copied: true, projectId: input.projectId, revision: saved.revision, originalPreserved: true }); return true;
      }
      if (path === "/runtime/identity/activity" && request.method === "POST") {
        sameOrigin(request); const grant = await grantForRequest(request), input = await bodyJSON(request);
        if (!grant?.familyID || input.csrf !== grant.csrf || Object.keys(input).sort().join(',') !== 'action,csrf,eventId' ||
          !['edit', 'save', 'open-project', 'review-tool'].includes(input.action) || !/^[A-Za-z0-9_-]{43}$/.test(input.eventId || ''))
          throw fault("Activity requires a reviewed action in this signed-in browser.", "developer_activity_invalid", 403);
        await family.Activity(grant.familyID, input.eventId, now()); json(response, 200, { accepted: true }); return true;
      }
      if (path === "/runtime/identity/logout" && request.method === "POST") {
        sameOrigin(request);
        const id = cookie(request, COOKIE);
        const saved = (kind, opaqueID) => { if (!/^[A-Za-z0-9_-]{43}$/.test(opaqueID || "")) return null; const row = db.prepare("SELECT * FROM developer_identity_records WHERE kind=? AND id_hash=?").get(kind, hash(opaqueID)); return row && row.expires_at > now() ? decode(kind, opaqueID, row) : null; };
        const grant = saved("session", id);
        const pendingID = cookie(request, TRANSACTION), pending = saved("pkce", pendingID);
        if (id) db.prepare("UPDATE developer_identity_records SET consumed=1 WHERE kind='session' AND id_hash=?").run(hash(id));
        if (pendingID) db.prepare("UPDATE developer_identity_records SET consumed=1 WHERE kind='pkce' AND id_hash=?").run(hash(pendingID));
        // Local exit must not depend on expired or unavailable central authority.
        // Start the durable family/intent fence before any awaited drain/network.
        const revoke = (grant?.familyID || pending?.intentID) ? family.Logout({ familyID: grant?.familyID, intentID: pending?.intentID }).then(() => true, () => false) : null;
        let centralRevoked = false, workspacesStopped = true;
        if (grant) {
          const owner = createHash("sha256").update(`YNX_DEVELOPER_IDENTITY_V1\n${CENTRAL_IDENTITY.audience}\n${grant.subject}`).digest("hex");
          try { await onSignOut?.(owner, id); } catch { workspacesStopped = false; }
          try { if (revoke) centralRevoked = await revoke; else { await backend("logout-grant", { clientId: CENTRAL_IDENTITY.clientId, grantToken: grant.grantToken }); centralRevoked = true; } } catch {}
        }
        else if (revoke) centralRevoked = await revoke;
        if (workspacesStopped && (!revoke || centralRevoked)) response.setHeader("set-cookie", [setCookie(COOKIE, "", 0), setCookie(TRANSACTION, "", 0)]);
        json(response, !workspacesStopped || (revoke && !centralRevoked) ? 503 : 200, { signedOut: true, centralRevoked, workspacesStopped, revocationPending: Boolean(revoke && !centralRevoked) }); return true;
      }
      if (path === "/sso/core-open" && request.method === "GET") {
        parentOnly(request); const sessionId = url.searchParams.get("sessionId");
        if (!/^[a-f0-9-]{36}$/.test(sessionId || "") || typeof coreSessionInfo !== "function") throw fault("Native IDE admission is unavailable.", "core_proxy_unavailable", 503);
        const info = await coreSessionInfo(request, sessionId), origin = new URL(info.origin);
        if (origin.protocol !== "https:" || origin.host === new URL(PARENT).host || origin.pathname !== "/" || origin.search || origin.hash) throw fault("Native IDE origin is invalid.", "core_proxy_origin_invalid", 403);
        const grant = await grantForRequest(request), ticket = random(), nonce = random();
        if (!grant) throw fault("Wallet sign-in is required.", "core_identity_required", 401);
        store("core-ticket", ticket, { ...grant, allowedHost: origin.host, allowedCoreSession: sessionId, identityExpiresAt: info.expiresAt }, now() + 60000);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
          "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${origin.origin}; base-uri 'none'; frame-ancestors 'none'` });
        response.end(`<title>YNX Developer · Opening project</title><form method="post" action="${origin.origin}/sso/core-admit"><input type="hidden" name="ticket" value="${ticket}"><button type="submit">Open YNX project</button></form><script nonce="${nonce}">document.forms[0].submit()</script>`); return true;
      }
      if (path === "/sso/core-admit" && request.method === "POST") {
        if (request.headers.origin !== PARENT || request.headers["content-type"] !== "application/x-www-form-urlencoded") throw fault("Native IDE admission origin did not match.", "core_proxy_origin_invalid", 403);
        const raw = await bodyBuffer(request), params = new URLSearchParams(raw), ticket = retrieve("core-ticket", params.get("ticket"), true);
        if ([...params].length !== 1 || !ticket || ticket.allowedHost !== host(request)) throw fault("Native IDE admission ticket expired or belongs to another origin.", "core_ticket_invalid", 401);
        const id = random(), expires = Math.min(ticket.identityExpiresAt, Date.parse(ticket.absoluteExpiresAt || ticket.expiresAt));
        if (!Number.isFinite(expires) || expires <= now()) throw fault("Native IDE identity expired.", "core_identity_invalid", 401);
        store("session", id, ticket, expires);
        // Every subsequent HTTP/WS request revalidates central identity + exact
        // session. This short exchange ticket never becomes a launch URL token.
        redirect(response, "/", [setCookie(COOKIE, id, Math.floor((expires - now()) / 1000))]); return true;
      }
      throw fault("Method not allowed.", "method_not_allowed", 405);
    } catch (error) { json(response, error.status || 503, { error: error.message || "Developer sign-in is unavailable.", code: error.code || "developer_sso_unavailable" }); return true; }
  }
  async function recordCoreActivity(request, sessionId, eventId, action) {
    const grant = await grantForRequest(request);
    if (!grant?.familyID || grant.allowedCoreSession !== sessionId || !grant.identityReference ||
      !['edit', 'save', 'terminal-input'].includes(action) || !/^[A-Za-z0-9_-]{43}$/.test(eventId || '') || !grant.isCurrent())
      throw fault("Activity is not bound to this current admitted workbench.", "developer_activity_invalid", 403);
    await family.Activity(grant.familyID, eventId, now());
    if (!grant.isCurrent()) throw fault("Workbench identity changed during activity.", "core_identity_changed", 401);
  }
  return { handler, verifyIdentity, grantForRequest, workspaceBinding, recordCoreActivity, close: () => db.close() };
}
async function bodyBuffer(request) { const chunks = []; let bytes = 0; for await (const chunk of request) { bytes += chunk.length; if (bytes > 8192) throw fault("Identity request too large.", "body_too_large", 413); chunks.push(chunk); } return Buffer.concat(chunks).toString("utf8"); }
async function bodyJSON(request) { try { return JSON.parse(await bodyBuffer(request)); } catch (error) { if (error.code) throw error; throw fault("Identity request must be JSON.", "invalid_json", 400); } }
function json(response, status, value) { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer" }); response.end(JSON.stringify(value)); }
