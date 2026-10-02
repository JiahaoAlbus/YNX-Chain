import { request as httpRequest, Agent } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fault } from "./central-identity.mjs";

// Mount only on A's isolated runtime origins. Parent-product cookies, bearer
// credentials and client identity headers never reach executable workspace code.
export function createCodeOSSProxy({ service, driver, sessionForHost, originForSession, recordActivity, now = Date.now, parentHost = "developer.ynxweb4.com" } = {}) {
  const sockets = new Set();
  const windows = new Map();
  const digest = value => createHash("sha256").update(value).digest("base64url");
  const marker = '__YNX_WORKBENCH_WINDOW_CAPABILITY_V1__';
  const reviewedHelper = recordActivity ? readFileSync(new URL('../../../native/ynx-brand/workbench-activity.js', import.meta.url), 'utf8') : null;
  const topDocument = request => request.method === 'GET' && new URL(request.url, 'https://local.invalid').pathname === '/' &&
    request.headers['sec-fetch-dest'] === 'document' && request.headers['sec-fetch-mode'] === 'navigate';
  async function activity(request, response, admitted) {
    if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json' ||
      request.headers['sec-fetch-site'] !== 'same-origin' || request.headers['sec-fetch-dest'] !== 'empty' ||
      request.headers.origin !== new URL(admitted.origin).origin || typeof recordActivity !== 'function')
      throw fault('Workbench activity request is not admitted.', 'core_activity_invalid', 403);
    const abort = setTimeout(() => request.destroy(), 2500); abort.unref?.();
    let body = '';
    try { for await (const chunk of request) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 1024) throw fault('Activity body is too large.', 'core_activity_invalid', 413); } }
    finally { clearTimeout(abort); }
    let input; try { input = JSON.parse(body); } catch { throw fault('Activity body is invalid.', 'core_activity_invalid', 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fault('Activity body is invalid.', 'core_activity_invalid', 400);
    const entry = typeof input.capability === 'string' ? windows.get(digest(input.capability)) : null;
    if (Object.keys(input).sort().join(',') !== 'action,capability,eventId' || !entry || entry.expiresAt <= now() ||
      entry.sessionId !== admitted.sessionId || entry.reference !== admitted.identity?.identityReference ||
      !entry.reference || !['edit','save','terminal-input'].includes(input.action) ||
      !/^[a-f0-9-]{36}$/.test(input.eventId || '')) throw fault('Activity belongs to another or retired workbench.', 'core_activity_invalid', 403);
    if (entry.events.has(input.eventId)) throw fault('Workbench activity was already submitted.', 'core_activity_replay', 409);
    if (entry.busy || now() - entry.lastAt < 30000 || entry.events.size >= 256) throw fault('Workbench activity is already being processed.', 'core_activity_rate', 429);
    entry.events.add(input.eventId);
    entry.busy = true; entry.lastAt = now();
    try {
      await recordActivity(request, admitted.sessionId, digest(`${input.capability}:${input.eventId}`), input.action);
      admitted.identity?.isCurrent?.();
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end('{"accepted":true}');
    } finally { entry.busy = false; }
  }
  async function admission(request) {
    if (!sessionForHost || !originForSession || !driver?.connect) throw fault("Native IDE proxy admission is unavailable.", "core_proxy_unavailable", 503);
    const sessionId = await sessionForHost(request.headers.host);
    if (!sessionId) {
      if (request.headers.host === parentHost) return null;
      throw fault("Unknown native IDE origin.", "core_proxy_origin_invalid", 403);
    }
    const origin = await originForSession(sessionId);
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.hostname === "developer.ynxweb4.com" || parsed.host !== request.headers.host || parsed.pathname !== "/")
      throw fault("Native IDE proxy origin is not the admitted runtime.", "core_proxy_origin_invalid", 403);
    if ((request.method !== "GET" && request.method !== "HEAD") || request.headers.upgrade) {
      if (request.headers.origin !== parsed.origin) throw fault("Native IDE request origin did not match.", "core_proxy_origin_invalid", 403);
    }
    if (request.headers.origin && request.headers.origin !== parsed.origin) throw fault("Native IDE request origin did not match.", "core_proxy_origin_invalid", 403);
    const authorization = await service.authorizeConnection(request, sessionId);
    return { sessionId, origin, ...authorization };
  }

  async function upstream(request, admitted) {
    if (!request.url.startsWith("/") || request.url.startsWith("//") || /[\r\n\\]/.test(request.url))
      throw fault("Native IDE proxy path is invalid.", "core_proxy_path_invalid", 400);
    const target = new URL(request.url, admitted.origin);
    const { socket, tokenMode } = await driver.connect(admitted.context);
    if (tokenMode !== "private-loopback-without-connection-token") { socket.destroy(); throw fault("Native IDE private listener mode is invalid.", "core_isolation_invalid", 503); }
    // The official remote-agent protocol returns its kernel token to clients.
    // This isolated loopback listener has no kernel token; the outer verified
    // owner/project/session admission is the sole external authority.
    target.searchParams.delete("tkn");
    const headers = {};
    for (const key of ["accept", "accept-language", "content-type", "content-length", "if-none-match", "range", "user-agent", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "sec-websocket-extensions", "upgrade", "connection"])
      if (request.headers[key] !== undefined) headers[key] = request.headers[key];
    headers.host = new URL(admitted.origin).host;
    const agent = new Agent({ keepAlive: false });
    agent.createConnection = (_options, callback) => { callback(null, socket); return socket; };
    const outgoing = httpRequest({ host: "127.0.0.1", port: 3000, method: request.method,
      path: target.pathname + target.search, headers, agent });
    const expires = setTimeout(() => socket.destroy(), Math.max(1, admitted.expiresAt - Date.now())); expires.unref?.();
    // Also revalidate long-lived HTTP streams and WSs; expiry alone does not
    // detect Wallet revocation/account generation changes.
    const recheck = setInterval(() => { service.authorizeConnection(request, admitted.sessionId).catch(() => socket.destroy()); }, 5000); recheck.unref?.();
    sockets.add(socket);
    socket.once("close", () => { clearTimeout(expires); clearInterval(recheck); sockets.delete(socket); agent.destroy(); });
    return outgoing;
  }

  async function handler(request, response) {
    try {
      const admitted = await admission(request); if (!admitted) return false;
      const requestedPath = new URL(request.url, admitted.origin).pathname;
      if (recordActivity && request.headers['service-worker'] === 'script' &&
        !requestedPath.endsWith('/vs/workbench/contrib/webview/browser/pre/service-worker.js'))
        throw fault('Executable workspace files cannot control the admitted workbench.', 'core_worker_scope_invalid', 403);
      if (new URL(request.url, admitted.origin).pathname === '/runtime/workbench-activity') { await activity(request, response, admitted); return true; }
      const outgoing = await upstream(request, admitted);
      outgoing.on("response", async remote => {
        const headers = { ...remote.headers, "cache-control": "no-store", "referrer-policy": "no-referrer" };
        delete headers["set-cookie"]; // includes vscode-tkn; backend admission remains authoritative
        delete headers['service-worker-allowed'];
        // Workspace/gallery documents and the webview content host must not
        // execute with the admitted workbench's DOM authority. The immutable
        // extension-worker bootstrap is trusted code; its untrusted extension
        // runs in a Worker (no parent DOM), not in this bootstrap document.
        const pathname = new URL(request.url, admitted.origin).pathname;
        const untrustedDocument = pathname.startsWith('/vscode-remote-resource') || pathname.startsWith('/web-extension-resource/') ||
          pathname.endsWith('/vs/workbench/contrib/webview/browser/pre/index.html') ||
          pathname.endsWith('/vs/workbench/contrib/webview/browser/pre/fake.html');
        if (recordActivity && untrustedDocument) {
          headers['content-security-policy'] = `${String(headers['content-security-policy'] || "default-src 'none'")}; sandbox allow-scripts allow-downloads`;
          headers['x-content-type-options'] = 'nosniff';
        }
        if (recordActivity && topDocument(request) && remote.statusCode === 200 && String(headers['content-type']).includes('text/html')) {
          try {
            const chunks = []; let size = 0;
            for await (const chunk of remote) { size += chunk.length; if (size > 1024 * 1024) throw fault('Fixed workbench entry is too large.', 'core_workbench_invalid', 503); chunks.push(chunk); }
            let html = Buffer.concat(chunks).toString('utf8');
            if (html.split(marker).length !== 2 || html.split('<script data-ynx-workbench-activity="v1">').length !== 2)
              throw fault('Runtime does not contain the reviewed activity entry.', 'core_workbench_invalid', 503);
            const start = html.indexOf('<script data-ynx-workbench-activity="v1">');
            const before = html.slice(0, start).replace(/<!--[\s\S]*?-->/g, '').trim();
            const expected = `<script data-ynx-workbench-activity="v1">${reviewedHelper}</script>`;
            if (!/^(?:<!doctype html>\s*)?<html>\s*<head>$/i.test(before) || !html.slice(start).startsWith(expected))
              throw fault('Activity bootstrap is not the first reviewed workbench script.', 'core_workbench_invalid', 503);
            for (const [key, value] of windows) if (value.expiresAt <= now()) windows.delete(key);
            if (windows.size >= 4096) throw fault('Workbench document capacity is temporarily unavailable.', 'core_activity_unavailable', 503);
            if (!admitted.identity?.identityReference) throw fault('Workbench has no current parent identity.', 'core_activity_invalid', 403);
            const capability = randomBytes(32).toString('base64url'), nonce = randomBytes(24).toString('base64url');
            windows.set(digest(capability), { sessionId: admitted.sessionId, reference: admitted.identity.identityReference,
              expiresAt: admitted.expiresAt, busy: false, lastAt: -Infinity, events: new Set() });
            html = html.replace(marker, capability).replace('<script data-ynx-workbench-activity="v1">', `<script nonce="${nonce}" data-ynx-workbench-activity="v1">`);
            const csp = String(headers['content-security-policy'] || '');
            if (!/script-src\s/.test(csp)) throw fault('Workbench script policy is missing.', 'core_workbench_invalid', 503);
            headers['content-security-policy'] = csp.replace(/script-src\s/, `script-src 'nonce-${nonce}' `);
            headers['x-content-type-options'] = 'nosniff';
            delete headers['content-length']; delete headers['content-encoding']; delete headers.etag;
            response.writeHead(remote.statusCode, headers); response.end(html); return;
          } catch (error) { json(response, error.status || 503, error.code || 'core_workbench_invalid'); return; }
        }
        if (headers.location) {
          try { const location = new URL(headers.location, admitted.origin); location.searchParams.delete("tkn");
            if (location.origin !== admitted.origin) delete headers.location;
            else headers.location = location.pathname + location.search + location.hash;
          } catch { delete headers.location; }
        }
        response.writeHead(remote.statusCode, headers); remote.pipe(response);
      });
      outgoing.on("error", () => { if (!response.headersSent) json(response, 502, "core_proxy_failed"); else response.destroy(); });
      request.on("aborted", () => outgoing.destroy()); response.on("close", () => outgoing.destroy());
      let bytes = 0;
      request.on("data", chunk => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) outgoing.destroy(); });
      request.pipe(outgoing); return true;
    } catch (error) { json(response, error.status || 503, error.code || "core_proxy_unavailable"); return true; }
  }

  // Server's upgrade owner calls this and awaits its returned admission result.
  // No synchronous true can be reported before identity validation completes.
  async function handleUpgrade(request, socket, head) {
    try {
      const admitted = await admission(request); if (!admitted) return false;
      if (String(request.headers.upgrade).toLowerCase() !== "websocket") throw fault("Unsupported upgrade.", "core_proxy_upgrade_invalid", 400);
      const outgoing = await upstream(request, admitted);
      outgoing.on("upgrade", (response, remote, remainder) => {
        socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`);
        for (const [key, value] of Object.entries(response.headers)) if (key !== "set-cookie") socket.write(`${key}: ${value}\r\n`);
        socket.write("\r\n"); if (remainder.length) socket.write(remainder); if (head.length) remote.write(head);
        remote.pipe(socket); socket.pipe(remote);
        socket.on("close", () => remote.destroy()); remote.on("close", () => socket.destroy());
      });
      outgoing.on("response", () => socket.destroy()); outgoing.on("error", () => socket.destroy()); outgoing.end(); return true;
    } catch (error) { socket.end(`HTTP/1.1 ${error.status || 503} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return true; }
  }
  return { handler, handleUpgrade, close: () => { windows.clear(); for (const socket of sockets) socket.destroy(); } };
}
function json(response, status, code) { if (!response.headersSent) response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify({ code })); }
