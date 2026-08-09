const PROTOCOL = "ynx-code-wallet-readiness/v1";
const PRODUCT_CLIENT_ID = "ynx-developer-v1";
const BUNDLE_ID = "com.ynxweb4.developer.testnetpreview";
const CALLBACK = "ynxdeveloper://wallet-auth/callback";
const SCOPES = ["account:read", "developer:deploy"];
const MAX_RESPONSE = 64 * 1024;
const MAX_COMPLETION = 128 * 1024;

export function createWalletReadinessService({
  ownerForRequest,
  gatewayURL = process.env.YNX_CODE_WALLET_GATEWAY_URL || "http://127.0.0.1:18445",
  fetcher = fetch,
  maxOwnerRequests = 2,
  maxGlobalRequests = 32,
} = {}) {
  const upstream = approvedUpstream(gatewayURL), owners = new Map();
  let active = 0;

  async function handler(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    const readinessRoute = url.pathname === "/runtime/wallet/readiness";
    const completionRoute = url.pathname === "/runtime/wallet/sessions/complete";
    if (!readinessRoute && !completionRoute) return false;
    const expectedMethod = readinessRoute ? "GET" : "POST";
    if (request.method !== expectedMethod) {
      json(response, 405, { code: "wallet_route_not_allowed", error: `Wallet route accepts ${expectedMethod} only.` });
      return true;
    }
    const owner = ownerForRequest?.(request);
    if (!owner) {
      json(response, 401, { code: "workspace_session_required", error: "A signed workspace session is required." });
      return true;
    }
    const ownerActive = owners.get(owner) || 0;
    if (ownerActive >= maxOwnerRequests || active >= maxGlobalRequests) {
      json(response, 429, { code: "wallet_capacity_exhausted", error: "Wallet capacity is currently full." });
      return true;
    }
    owners.set(owner, ownerActive + 1);
    active++;
    try {
      const gate = await readiness(fetcher, upstream);
      if (readinessRoute) {
        json(response, 200, gate);
        return true;
      }
      if (!gate.gateway.remoteDeployed || !gate.gateway.publicDeploymentReady || !gate.developerBinding.attested) {
        json(response, 503, { code: "wallet_public_gate_closed", error: "The public Developer Wallet Gateway is not attested and ready." });
        return true;
      }
      if (request.headers["content-type"] !== "application/json") {
        json(response, 415, { code: "wallet_content_type_required", error: "Wallet completion requires application/json." });
        return true;
      }
      const body = await boundedBody(request);
      let value;
      try { value = JSON.parse(body); } catch { throw fault("Wallet completion is invalid JSON.", "wallet_invalid_completion", 400); }
      if (canonicalJSON(value) !== body) throw fault("Wallet completion must be canonical JSON.", "wallet_noncanonical_completion", 400);
      const completed = await read(fetcher, new URL("v1/wallet/sessions/complete", upstream), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body,
      });
      json(response, 200, { protocolVersion: PROTOCOL, session: completed.result });
      return true;
    } catch (error) {
      json(response, error.status || 503, {
        ...(readinessRoute ? unavailableReadiness() : {}),
        code: error.code || "wallet_gateway_unreachable",
        error: error.message || "Wallet Gateway is unreachable.",
      });
      return true;
    } finally {
      active--;
      const next = (owners.get(owner) || 1) - 1;
      if (next) owners.set(owner, next); else owners.delete(owner);
    }
  }
  return { handler, status: () => ({ protocolVersion: PROTOCOL, upstream: upstream.origin, maxOwnerRequests, maxGlobalRequests, active }) };
}

async function readiness(fetcher, upstream) {
  const [health, ready, version] = await Promise.all([
    read(fetcher, new URL("health", upstream)),
    read(fetcher, new URL("ready", upstream)),
    read(fetcher, new URL("version", upstream)),
  ]);
  return {
    protocolVersion: PROTOCOL,
    gateway: {
      reachable: true,
      remoteDeployed: health.remoteDeployed === true,
      runtimeReady: ready.runtimeReady === true,
      publicDeploymentReady: ready.publicDeploymentReady === true,
      build: version.build ?? null,
    },
    developerBinding: developerAttestation(version),
  };
}

function unavailableReadiness() {
  return {
    protocolVersion: PROTOCOL,
    gateway: { reachable: false, remoteDeployed: false, runtimeReady: false, publicDeploymentReady: false, build: null },
    developerBinding: developerAttestation(null),
  };
}

function developerAttestation(version) {
  const ids = Array.isArray(version?.enabledProductClientIds) ? version.enabledProductClientIds : [];
  const registrySha256 = version?.registrySha256;
  const exact = ids.includes(PRODUCT_CLIENT_ID) && typeof registrySha256 === "string" && /^[0-9a-f]{64}$/.test(registrySha256);
  return { productClientId: PRODUCT_CLIENT_ID, bundleId: BUNDLE_ID, callback: CALLBACK, scopes: SCOPES, attested: exact, registrySha256: exact ? registrySha256 : null, reason: exact ? "exact_gateway_registry_attested" : "gateway_version_does_not_attest_developer_registry" };
}

function approvedUpstream(value) {
  let url;
  try { url = new URL(value.endsWith("/") ? value : `${value}/`); } catch { throw new Error("YNX_CODE_WALLET_GATEWAY_URL must be an absolute URL."); }
  if (url.username || url.password || url.search || url.hash || url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) throw new Error("YNX_CODE_WALLET_GATEWAY_URL must be credential-free loopback HTTP.");
  return url;
}

async function read(fetcher, url, options = { headers: { accept: "application/json" } }) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
  let response;
  try { response = await fetcher(url, { redirect: "error", ...options, signal: controller.signal }); }
  catch { throw fault("Wallet Gateway is unreachable.", "wallet_gateway_unreachable", 503); }
  finally { clearTimeout(timer); }
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (declared > MAX_RESPONSE) throw fault("Wallet Gateway response is too large.", "wallet_response_too_large", 502);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE) throw fault("Wallet Gateway response is too large.", "wallet_response_too_large", 502);
  let value;
  try { value = JSON.parse(text); } catch { throw fault("Wallet Gateway returned invalid JSON.", "wallet_invalid_response", 502); }
  if (!response.ok || value?.ok !== true) throw fault("Wallet Gateway rejected the request.", "wallet_gateway_rejected", 502);
  return value;
}

function boundedBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0, body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_COMPLETION) { reject(fault("Wallet completion is too large.", "wallet_completion_too_large", 413)); request.destroy(); return; }
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", () => reject(fault("Wallet completion could not be read.", "wallet_completion_unreadable", 400)));
  });
}

function canonicalJSON(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) throw fault("Wallet completion contains an invalid number.", "wallet_invalid_completion", 400); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw fault("Wallet completion is invalid.", "wallet_invalid_completion", 400);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
}

function json(response, status, value) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(value)); }
function fault(message, code, status) { return Object.assign(new Error(message), { code, status }); }
