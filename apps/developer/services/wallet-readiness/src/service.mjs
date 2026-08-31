import { createHash } from "node:crypto";

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
  chainURL = process.env.YNX_CODE_CHAIN_URL || "https://rpc.ynxweb4.com",
  fetcher = fetch,
  chainFetcher = fetch,
  ideActionPublicReady = process.env.YNX_CODE_IDE_ACTION_PUBLIC_READY === "true",
  maxOwnerRequests = 2,
  maxGlobalRequests = 32,
} = {}) {
  const upstream = approvedUpstream(gatewayURL), chain = approvedChain(chainURL), owners = new Map();
  let active = 0;

  async function handler(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    const readinessRoute = url.pathname === "/runtime/wallet/readiness";
    const completionRoute = url.pathname === "/runtime/wallet/sessions/complete";
    const introspectionRoute = url.pathname === "/runtime/wallet/sessions/introspect";
    const deploymentRoute = url.pathname === "/runtime/wallet/deployments/broadcast";
    if (!readinessRoute && !completionRoute && !introspectionRoute && !deploymentRoute) return false;
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
      if (deploymentRoute && !ideActionPublicReady) {
        json(response, 503, { code: "ide_action_public_gate_closed", error: "Public YNX IDE application-action broadcast is not attested." });
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
      let upstreamPath = "v1/wallet/sessions/complete", upstreamBody = body, proofHeader;
      if (introspectionRoute || deploymentRoute) {
        if (deploymentRoute) {
          if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join("\n") !== "proof\nresponse") throw fault("Developer deployment envelope is invalid.", "deployment_invalid_envelope", 400);
        }
        const proof = value.proof;
        if (!proof || typeof proof !== "object" || Array.isArray(proof)) throw fault("Wallet introspection proof is invalid.", "wallet_invalid_proof", 400);
        upstreamPath = "v1/wallet/sessions/introspect";
        upstreamBody = canonicalJSON({ requiredScopes: ["developer:deploy"] });
        proofHeader = Buffer.from(canonicalJSON(proof), "utf8").toString("base64url");
      }
      const completed = await read(fetcher, new URL(upstreamPath, upstream), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", ...(proofHeader ? { "x-ynx-product-session-proof": proofHeader } : {}) },
        body: upstreamBody,
      });
      if (deploymentRoute) {
        const deployment = await broadcastDeployment(value.response, completed.result, chainFetcher, chain);
        json(response, 200, { protocolVersion: PROTOCOL, deployment });
      } else json(response, 200, { protocolVersion: PROTOCOL, ...(introspectionRoute ? { introspection: completed.result } : { session: completed.result }) });
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
  return { handler, status: () => ({ protocolVersion: PROTOCOL, upstream: upstream.origin, chain:chain.origin, ideActionPublicReady, maxOwnerRequests, maxGlobalRequests, active }) };
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
function approvedChain(value) {
  let url;
  try { url = new URL(value.endsWith("/") ? value : `${value}/`); }
  catch { throw new Error("YNX_CODE_CHAIN_URL must be an absolute URL."); }
  if (url.username || url.password || url.search || url.hash || !(
    url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname))
  )) throw new Error("YNX_CODE_CHAIN_URL must be HTTPS or credential-free loopback HTTP.");
  return url;
}

async function broadcastDeployment(response, introspection, fetcher, chain) {
  if (introspection?.active !== true || !introspection.session) throw fault("Developer Product Session is inactive.", "deployment_session_inactive", 403);
  const session = introspection.session;
  const responseFields = ["version", "requestDigest", "productClientId", "bundleId", "callback", "sessionBinding", "account", "action", "artifactDigest", "signedTransaction", "canonicalPayloadHex", "transactionHash", "issuedAt", "expiresAt"];
  if (!plainExact(response, responseFields) || response.version !== "1" || response.productClientId !== "ynx-developer-v1" || response.bundleId !== "com.ynxweb4.developer.testnetpreview" || response.callback !== "ynxdeveloper://deployment/callback" || response.action !== "ide_contract_deploy" || response.sessionBinding !== session.sessionBinding || response.account !== session.account || !Array.isArray(session.scopes) || !session.scopes.includes("developer:deploy") || !hex64(response.requestDigest) || !hex64(response.artifactDigest) || !/^0x[0-9a-f]{64}$/.test(response.transactionHash || "") || !/^0x[0-9a-f]+$/.test(response.canonicalPayloadHex || "") || response.canonicalPayloadHex.length % 2) {
    throw fault("Developer deployment binding is invalid.", "deployment_binding_mismatch", 403);
  }
  const raw = Buffer.from(response.canonicalPayloadHex.slice(2), "hex");
  if (raw.length < 2 || raw.length > 16 * 1024 || `0x${sha256(raw)}` !== response.transactionHash) throw fault("Developer deployment bytes or hash are invalid.", "deployment_hash_mismatch", 400);
  let transaction;
  try { transaction = JSON.parse(raw.toString("utf8")); }
  catch { throw fault("Developer transaction is not JSON.", "deployment_invalid_transaction", 400); }
  const envelopeFields = ["version", "chainId", "type", "signer", "nonce", "action", "payload", "payloadHash", "fee", "aiUnits", "payUnits", "publicKey", "signature"];
  const payloadFields = ["name", "source", "deployedBytecode", "constructorArgs", "idempotencyKey", "requestHash"];
  const payload = transaction.payload;
  const payloadBase = payload && { name: payload.name, source: payload.source, deployedBytecode: payload.deployedBytecode, constructorArgs: payload.constructorArgs, idempotencyKey: payload.idempotencyKey };
  const requestHash = payloadBase && sha256(JSON.stringify({ domain: "YNX_IDE_REQUEST_V1", action: "ide_contract_deploy", value: payloadBase }));
  const artifactDigest = payloadBase && sha256(`YNX_DEVELOPER_ARTIFACT_V1\n${canonicalJSON(payloadBase)}`);
  if (!plainExact(transaction, envelopeFields) || !plainExact(payload, payloadFields) || canonicalJSON(transaction) !== canonicalJSON(response.signedTransaction) || transaction.version !== 1 || transaction.chainId !== 6423 || transaction.type !== "application_action" || !/^0x[0-9a-f]{40}$/.test(transaction.signer || "") || !Number.isSafeInteger(transaction.nonce) || transaction.nonce < 1 || transaction.action !== "ide_contract_deploy" || transaction.fee !== 1 || transaction.aiUnits !== 0 || transaction.payUnits !== 0 || !/^(02|03)[0-9a-f]{64}$/.test(transaction.publicKey || "") || !/^[0-9a-f]{136,144}$/.test(transaction.signature || "") || transaction.payloadHash !== sha256(JSON.stringify(payload)) || payload.requestHash !== requestHash || response.artifactDigest !== artifactDigest) {
    throw fault("Developer signed transaction was widened.", "deployment_transaction_mismatch", 403);
  }
  await chainRead(fetcher, new URL("ide/deploy", chain), { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: raw });
  let receipt = null;
  for (let attempt = 0; attempt < 10 && !receipt; attempt++) {
    const rpc = await chainRead(fetcher, new URL("evm", chain), { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: `developer-receipt-${attempt}`, method: "eth_getTransactionReceipt", params: [response.transactionHash] }) });
    if (rpc.error) throw fault("YNX Chain rejected the receipt lookup.", "deployment_receipt_rejected", 502);
    receipt = rpc.result ?? null;
    if (!receipt && attempt < 9) await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!receipt || receipt.transactionHash !== response.transactionHash || receipt.status !== "0x1" || typeof receipt.blockNumber !== "string") throw fault("Deployment broadcast was accepted but its authoritative receipt is not final yet.", "deployment_receipt_pending", 504);
  return { transactionHash: response.transactionHash, artifactDigest: response.artifactDigest, account: response.account, confirmed: true, receipt };
}

async function chainRead(fetcher, url, options) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  let response;
  try { response = await fetcher(url, { ...options, redirect: "error", signal: controller.signal }); }
  catch { throw fault("YNX Chain is unreachable.", "deployment_chain_unreachable", 503); }
  finally { clearTimeout(timer); }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE) throw fault("YNX Chain response is too large.", "deployment_chain_response_too_large", 502);
  let value;
  try { value = JSON.parse(text); }
  catch { throw fault("YNX Chain returned invalid JSON.", "deployment_chain_invalid_response", 502); }
  if (!response.ok) throw fault("YNX Chain rejected the deployment.", "deployment_chain_rejected", 502);
  return value;
}

function plainExact(value, fields) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join("\n") === [...fields].sort().join("\n"));
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function hex64(value) { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }

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
