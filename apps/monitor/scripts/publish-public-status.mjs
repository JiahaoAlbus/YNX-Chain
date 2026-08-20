import { createHmac } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ranks = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4, unknown: 5 };

function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function nullableText(value, max = 120) { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null; }
function nullableCommit(value) {
  const commit = nullableText(value, 64);
  return commit && /^[a-f0-9]{7,64}$/i.test(commit) ? commit.toLowerCase() : null;
}
function nullableISO(value) { const millis = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(millis) ? new Date(millis).toISOString() : null; }
function publicDependencyStatus(value) {
  const normalized = String(record(value).status ?? value ?? "").toLowerCase();
  if (["healthy", "available", "operational", "ok", "ready"].includes(normalized)) return "operational";
  if (["warming", "maintenance", "not-yet-synced"].includes(normalized)) return "maintenance";
  if (["degraded", "lagging"].includes(normalized)) return "degraded";
  if (["unavailable", "failed", "outage", "error"].includes(normalized)) return "major_outage";
  return "unknown";
}
export async function boundedJSON(response) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 262_144) {
      await reader.cancel("bounded probe response exceeded its limit");
      throw new Error("bounded probe response exceeded its limit");
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("probe response must be a JSON object");
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === "probe response must be a JSON object") throw error;
    throw new Error("probe response was not valid JSON");
  }
}
function healthStatus(response, health, dependencies) {
  if (!response.ok || health.ok === false) return "major_outage";
  const explicit = String(health.status ?? "").toLowerCase();
  let status = health.ok === true || ["healthy", "available", "operational", "ok", "ready"].includes(explicit)
    ? "operational"
    : publicDependencyStatus(explicit);
  for (const dependency of dependencies) if (ranks[dependency.status] > ranks[status]) status = dependency.status;
  return status;
}
function identityFrom(...documents) {
  for (const document of documents) {
    const build = record(document.build);
    const sourceCommit = nullableCommit(document.sourceCommit ?? document.commit ?? build.commit);
    const release = nullableText(document.release ?? build.release);
    const startedAt = nullableISO(document.startedAt);
    if (sourceCommit || release || startedAt) return { sourceCommit, release, startedAt };
  }
  return { sourceCommit: null, release: null, startedAt: null };
}

function publicHTTPSURL(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a public HTTPS URL`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a public HTTPS URL`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be a credential-free public HTTPS URL without query or fragment`);
  }
  const host = url.hostname.toLowerCase();
  const blocked = host === "localhost" || host.endsWith(".local") || host === "example.com" || host.endsWith(".example")
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
  if (blocked) throw new Error(`${label} must not target localhost, reserved, or literal IP addresses`);
  return url;
}

function validatedProbe(probe) {
  if (!probe || !/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(probe.id || "") || typeof probe.name !== "string" || !probe.name.trim()) throw new Error("invalid public status probe");
  const url = publicHTTPSURL(probe.url, `public status probe ${probe.id}`);
  if (probe.versionUrl !== undefined && probe.versionUrl !== null && probe.versionUrl !== "") {
    const versionURL = publicHTTPSURL(probe.versionUrl, `public status version probe ${probe.id}`);
    if (versionURL.origin !== url.origin) throw new Error(`public status version probe ${probe.id} must share the health origin`);
  }
  return probe;
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  throw new Error("public status contains a non-canonical value");
}

export function signSnapshot(snapshot, key) {
  if (typeof key !== "string" || key.length < 32) throw new Error("YNX_MONITOR_PUBLIC_STATUS_INTEGRITY_KEY must contain at least 32 characters");
  return { ...snapshot, integrity: { algorithm: "hmac-sha256", digest: createHmac("sha256", key).update(JSON.stringify(canonical(snapshot))).digest("hex") } };
}

export async function buildSnapshot({ probes, key, source, approvalId, timeoutMs = 2500, now = new Date(), fetcher = fetch }) {
  if (!Array.isArray(probes) || !probes.length || probes.length > 64) throw new Error("YNX_MONITOR_PUBLIC_STATUS_PROBES must contain 1..64 probes");
  if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(source || "")) throw new Error("YNX_MONITOR_PUBLIC_STATUS_EXPECTED_SOURCE is invalid");
  if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(approvalId || "")) throw new Error("YNX_MONITOR_PUBLIC_STATUS_APPROVAL_ID is invalid");
  const asOf = now.toISOString();
  const rawServices = await Promise.all(probes.map(async (probe) => {
    validatedProbe(probe);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
	  const response = await fetcher(probe.url, { signal: controller.signal, headers: { accept: "application/json" } });
	  const health = await boundedJSON(response);
	  let version = {};
	  if (typeof probe.versionUrl === "string" && probe.versionUrl) {
		try { const versionResponse = await fetcher(probe.versionUrl, { signal: controller.signal, headers: { accept: "application/json" } }); if (versionResponse.ok) version = await boundedJSON(versionResponse); } catch { version = {}; }
	  }
	  const identity = identityFrom(version, health);
	  const reportedDependencies = record(health.dependencies);
	  const dependencyIDs = [...new Set([...(Array.isArray(probe.dependencies) ? probe.dependencies : []), ...Object.keys(reportedDependencies)])].filter((id) => /^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(id)).slice(0, 20);
	  const baseStatus = healthStatus(response, health, []);
	  return { id: probe.id, name: probe.name.slice(0, 120), baseStatus, asOf, checkedAt: asOf, ...identity, dependencyIDs, reportedDependencies };
    } catch {
	  return { id: probe.id, name: probe.name.slice(0, 120), baseStatus: "major_outage", asOf, checkedAt: asOf, sourceCommit: null, release: null, startedAt: null, dependencyIDs: (Array.isArray(probe.dependencies) ? probe.dependencies : []).filter((id) => /^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(id)).slice(0,20), reportedDependencies: {} };
    } finally { clearTimeout(timeout); }
  }));
  // Resolve configured dependency IDs from the corresponding probes. Iterate to
  // a fixed point so a failed RPC propagates through indexer and explorer even
  // when those health payloads omit their own dependency maps.
  const resolvedStatuses = new Map(rawServices.map((service) => [service.id, service.baseStatus]));
  for (let pass = 0; pass < rawServices.length; pass++) {
	let changed = false;
	for (const service of rawServices) {
	  let status = service.baseStatus;
	  for (const id of service.dependencyIDs) {
		const dependencyStatus = id in service.reportedDependencies ? publicDependencyStatus(service.reportedDependencies[id]) : (resolvedStatuses.get(id) || "unknown");
		if (status !== "major_outage" && ranks[dependencyStatus] > ranks[status]) status = dependencyStatus;
	  }
	  if (resolvedStatuses.get(service.id) !== status) { resolvedStatuses.set(service.id, status); changed = true; }
	}
	if (!changed) break;
  }
  const services = rawServices.map(({ baseStatus, dependencyIDs, reportedDependencies, ...service }) => {
	const dependencies = dependencyIDs.map((id) => ({ id, status: id in reportedDependencies ? publicDependencyStatus(reportedDependencies[id]) : (resolvedStatuses.get(id) || "unknown") }));
	const status = resolvedStatuses.get(service.id) || "unknown";
	return { ...service, status, dependencies, message: status === "operational" ? "Configured public HTTPS probe returned a healthy response." : baseStatus === "major_outage" ? "Configured public HTTPS probe was unavailable or unhealthy." : "A configured dependency did not return a healthy response." };
  });
  const status = services.reduce((worst, service) => ranks[service.status] > ranks[worst] ? service.status : worst, "operational");
  return signSnapshot({
	  schemaVersion: "ynx.monitor.public-status-source.v2",
    source,
    version: `status-${now.getTime()}`,
    asOf,
    status,
    message: status === "operational" ? "All configured public Testnet probes returned successful responses." : "One or more configured public Testnet probes did not return a successful response.",
    services,
    incidents: [],
    approval: { status: "approved", approvalId, approvedAt: asOf, approvedByRole: "incident_commander" },
  }, key);
}

export async function publishFromEnvironment(env = process.env) {
  const output = env.YNX_MONITOR_PUBLIC_STATUS_PATH;
  if (!output) throw new Error("YNX_MONITOR_PUBLIC_STATUS_PATH is required");
  const snapshot = await buildSnapshot({
    probes: JSON.parse(env.YNX_MONITOR_PUBLIC_STATUS_PROBES || "[]"),
    key: env.YNX_MONITOR_PUBLIC_STATUS_INTEGRITY_KEY,
    source: env.YNX_MONITOR_PUBLIC_STATUS_EXPECTED_SOURCE,
    approvalId: env.YNX_MONITOR_PUBLIC_STATUS_APPROVAL_ID,
  });
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o640 });
  await rename(temporary, output);
  return snapshot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishFromEnvironment().then((snapshot) => console.log(JSON.stringify({ status: snapshot.status, version: snapshot.version, services: snapshot.services.length }))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
