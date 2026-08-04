import { createHmac } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ranks = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4, unknown: 5 };

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

export async function buildSnapshot({ probes, key, source, approvalId, timeoutMs = 2500, now = new Date() }) {
  if (!Array.isArray(probes) || !probes.length || probes.length > 64) throw new Error("YNX_MONITOR_PUBLIC_STATUS_PROBES must contain 1..64 probes");
  if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(source || "")) throw new Error("YNX_MONITOR_PUBLIC_STATUS_EXPECTED_SOURCE is invalid");
  if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(approvalId || "")) throw new Error("YNX_MONITOR_PUBLIC_STATUS_APPROVAL_ID is invalid");
  const asOf = now.toISOString();
  const services = await Promise.all(probes.map(async (probe) => {
    if (!probe || !/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(probe.id || "") || typeof probe.name !== "string" || !probe.name.trim() || typeof probe.url !== "string") throw new Error("invalid public status probe");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(probe.url, { signal: controller.signal, headers: { accept: "application/json" } });
      return { id: probe.id, name: probe.name.slice(0, 120), status: response.ok ? "operational" : "major_outage", asOf, message: response.ok ? "Bounded public probe returned a successful response." : "Bounded public probe did not return a successful response." };
    } catch {
      return { id: probe.id, name: probe.name.slice(0, 120), status: "major_outage", asOf, message: "Bounded public probe was unavailable before its timeout." };
    } finally { clearTimeout(timeout); }
  }));
  const status = services.reduce((worst, service) => ranks[service.status] > ranks[worst] ? service.status : worst, "operational");
  return signSnapshot({
    schemaVersion: "ynx.monitor.public-status-source.v1",
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
