import { performance } from "node:perf_hooks";

const base = process.env.YNX_RESOURCE_MARKET_URL || "http://127.0.0.1:16442";
const requests = Number(process.env.YNX_CAPACITY_REQUESTS || 1000);
const concurrency = Number(process.env.YNX_CAPACITY_CONCURRENCY || 25);
if (!Number.isInteger(requests) || requests < 100 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200) {
  throw new Error("YNX_CAPACITY_REQUESTS must be >=100 and concurrency must be 1..200");
}

const headers = (actor, role = "user") => ({
  "content-type": "application/json",
  "x-ynx-actor": actor,
  "x-ynx-role": role,
});
async function action(actor, body, role = "user") {
  const response = await fetch(`${base}/api/market/actions`, { method: "POST", headers: headers(actor, role), body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`bootstrap ${body.type} failed: ${response.status} ${JSON.stringify(value)}`);
  return value.result;
}
const asOf = new Date().toISOString();
const expiry = new Date(Date.now() + 3_600_000).toISOString();
const source = { kind: "local_capacity_probe", asOf, version: "1", coverage: "ephemeral local probe", status: "available" };
for (const suffix of ["a", "b"]) {
  const wallet = `capacity-provider-${suffix}`;
  const provider = await action(wallet, { type: "register_provider", provider: { wallet, name: `Capacity Provider ${suffix.toUpperCase()}`, region: "local", hardware: ["local-probe-worker"], securityBond: 1000, source } });
  await action("capacity-verifier", { type: "verify_provider", providerId: provider.id, provider: { evidence: [`probe-attestation-${suffix}`] } }, "resource_verifier");
  await action(wallet, { type: "publish_offer", offer: { providerId: provider.id, resource: "cpu_compute", unit: "vcpu-second", pricing: "fixed", currency: "YNXT-testnet", unitPrice: suffix === "a" ? 2 : 3, capacity: 1_000_000, minUnits: 1, maxUnits: 100_000, slaUptime: .99, latencyMs: suffix === "a" ? 10 : 20, source, expiresAt: expiry } });
}

const samples = [];
let failures = 0;
let next = 0;
const started = performance.now();
async function worker() {
  while (true) {
    const index = next++;
    if (index >= requests) return;
    const before = performance.now();
    try {
      const response = await fetch(`${base}/api/market/matches?resource=cpu_compute&units=100`, { headers: headers(`capacity-buyer-${index % 10}`) });
      const body = await response.json();
      if (!response.ok || body.offers?.length !== 2) failures++;
    } catch { failures++; }
    samples.push(performance.now() - before);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsedMs = performance.now() - started;
samples.sort((a, b) => a - b);
const percentile = (p) => Number(samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)].toFixed(3));
const result = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  scope: "local loopback HTTP matching read; two ephemeral providers; no public-network or chain-settlement claim",
  requests,
  concurrency,
  completed: samples.length,
  failures,
  errorRate: Number((failures / requests).toFixed(6)),
  elapsedMs: Number(elapsedMs.toFixed(3)),
  throughputRequestsPerSecond: Number((requests / (elapsedMs / 1000)).toFixed(2)),
  latencyMs: { p50: percentile(.50), p95: percentile(.95), p99: percentile(.99), max: Number(samples.at(-1).toFixed(3)) },
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures) process.exitCode = 1;
