import { request as httpRequest, Agent } from "node:http";
import { fault } from "./central-identity.mjs";

// Mount only on A's isolated runtime origins. Parent-product cookies, bearer
// credentials and client identity headers never reach executable workspace code.
export function createCodeOSSProxy({ service, driver, sessionForHost, originForSession, parentHost = "developer.ynxweb4.com" } = {}) {
  const sockets = new Set();
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
      const outgoing = await upstream(request, admitted);
      outgoing.on("response", remote => {
        const headers = { ...remote.headers, "cache-control": "no-store", "referrer-policy": "no-referrer" };
        delete headers["set-cookie"]; // includes vscode-tkn; backend admission remains authoritative
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
  return { handler, handleUpgrade, close: () => { for (const socket of sockets) socket.destroy(); } };
}
function json(response, status, code) { if (!response.headersSent) response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify({ code })); }
