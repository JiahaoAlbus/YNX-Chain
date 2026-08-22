import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifact = path.join(root, "release/integration/p0-wallet-connectivity/artifacts/wallet-auth-v2-runtime-closure-6cf3ef84");
const fail = (message) => { throw new Error(message); };
const parseVersionSource = (text) => {
  const body = JSON.parse(text);
  if (!body || typeof body !== "object" || !body.build || typeof body.build !== "object" || typeof body.build.sourceCommit !== "string") fail("/version response schema mismatch: build.sourceCommit is required");
  return body.build.sourceCommit;
};
const parseCanonicalErrorCode = (text) => {
  const body = JSON.parse(text);
  if (!body || typeof body !== "object" || !body.error || typeof body.error !== "object" || typeof body.error.code !== "string") fail("canonical error response schema mismatch: error.code is required");
  return body.error.code;
};
if (process.argv.includes("--self-test")) {
  if (parseVersionSource(JSON.stringify({ build: { sourceCommit: "6cf3ef845202bd879ed94515a71b323dd2fc9e14" } })) !== "6cf3ef845202bd879ed94515a71b323dd2fc9e14") fail("version schema self-test failed");
  if (parseCanonicalErrorCode(JSON.stringify({ error: { code: "UNKNOWN_OR_MISSING_FIELD" }, ok: false })) !== "UNKNOWN_OR_MISSING_FIELD") fail("error schema self-test failed");
  console.log("PASS copied-runtime response schema self-test: build.sourceCommit and error.code");
  process.exit(0);
}
const required = (name) => process.env[name] || fail(`${name} is required`);
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const runtime = path.resolve(required("YNX_COPIED_49E_RUNTIME_DIR"));
const markerPath = path.join(runtime, ".ynx-copied-49e-preflight.json");
const v1State = path.resolve(required("YNX_COPIED_49E_V1_STATE_PATH"));
const v1Registry = path.resolve(required("YNX_COPIED_49E_V1_REGISTRY_PATH"));
const v2Registry = path.resolve(required("YNX_V2_REGISTRY_PATH"));
const v2State = path.resolve(required("YNX_V2_STATE_PATH"));
const port = Number(process.env.YNX_COLDSTART_PORT ?? "18446");
if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("YNX_COLDSTART_PORT is invalid");
if (runtime === "/opt/ynx/wallet-auth" || runtime.startsWith("/opt/ynx/wallet-auth/")) fail("production runtime path is forbidden");
if (!fs.existsSync(markerPath)) fail("copied-runtime marker is missing");
const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
if (marker.source !== "49e30d999e9a9cbdd2c565021009f2cab0dc125c" || marker.v1StateSha256 !== "93b18583abac95d040e5feca6c1db778f9193ac3471c5415d38e411b60ac63cb" || hash(v1State) !== marker.v1StateSha256) fail("copied-runtime marker or v1 state identity mismatch");
if (v2State === v1State) fail("v2 state path must be independent");
const runtimeArchive = path.join(artifact, "wallet-auth-v2-noble-runtime-closure-6cf3ef84.tar.gz");
if (hash(runtimeArchive) !== "2a2f29218914580bce70dcc31852186223965b8cf1c5cd34c3cb66c7edf69a54") fail("runtime dependency archive mismatch");
const extract = spawnSync("tar", ["-xzf", runtimeArchive, "-C", runtime], { encoding: "utf8" });
if (extract.status !== 0) fail(`dependency extraction failed: ${extract.stderr}`);
const daemon = path.join(runtime, "packages/wallet-auth/scripts/ynx-wallet-gatewayd.mjs");
const child = spawn(process.execPath, [daemon], {
  cwd: path.join(runtime, "packages/wallet-auth"),
  env: {
    ...process.env,
    YNX_WALLET_GATEWAY_HTTP_ADDR: "127.0.0.1",
    YNX_WALLET_GATEWAY_HTTP_PORT: String(port),
    YNX_WALLET_GATEWAY_STATE_PATH: v1State,
    YNX_WALLET_GATEWAY_REGISTRY_PATH: v1Registry,
    YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH: v2Registry,
    YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH: v2State,
    YNX_WALLET_GATEWAY_REMOTE_DEPLOYED: "false",
    YNX_WALLET_GATEWAY_SOURCE_COMMIT: "6cf3ef845202bd879ed94515a71b323dd2fc9e14",
    YNX_WALLET_GATEWAY_RELEASE: "p0-v2-copied-49e-coldstart",
    YNX_WALLET_GATEWAY_BUILD_TIME: "2026-08-20T12:24:41.000Z"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let logs = "";
child.stdout.on("data", (chunk) => { if (logs.length < 65536) logs += chunk; });
child.stderr.on("data", (chunk) => { if (logs.length < 65536) logs += chunk; });
const request = async (pathname, init) => {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, signal: AbortSignal.timeout(3000) });
  const text = await response.text();
  return { response, text };
};
try {
  let version;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) fail(`daemon exited ${child.exitCode}: ${logs}`);
    try { version = await request("/version"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  if (!version || version.response.status !== 200 || parseVersionSource(version.text) !== "6cf3ef845202bd879ed94515a71b323dd2fc9e14") fail("exact /version source gate failed");
  for (const endpoint of ["/health", "/ready"]) if ((await request(endpoint)).response.status !== 200) fail(`${endpoint} gate failed`);
  const options = await request("/v2/product-sessions/challenge", { method: "OPTIONS", headers: { Origin: "https://finance.ynxweb4.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
  if (options.response.status !== 204 || options.response.headers.get("access-control-allow-origin") !== "https://finance.ynxweb4.com" || options.response.headers.has("access-control-allow-credentials")) fail("registered-origin CORS gate failed");
  const invalid = await request("/v2/product-sessions/challenge", { method: "POST", headers: { Origin: "https://finance.ynxweb4.com", "Content-Type": "application/json" }, body: "{}" });
  if (invalid.response.status !== 400 || parseCanonicalErrorCode(invalid.text) !== "UNKNOWN_OR_MISSING_FIELD") fail("invalid challenge fail-closed gate failed");
  console.log(JSON.stringify({ copied49eColdStart: true, source: "6cf3ef845202bd879ed94515a71b323dd2fc9e14", v1StateSha256: marker.v1StateSha256, health: 200, ready: 200, version: 200, financeOptions: 204, invalidChallenge: 400, productionMutationAuthorized: false }));
} finally {
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
