#!/usr/bin/env node
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isIP } from "node:net";

const endpoints = [
  { name: "rpc", host: "rpc.ynxweb4.com", path: "/status", kind: "rpc" },
  { name: "evm", host: "evm.ynxweb4.com", path: "/", kind: "evm" },
  { name: "rest", host: "rest.ynxweb4.com", path: "/status" },
  { name: "faucet", host: "faucet.ynxweb4.com", path: "/health" },
  { name: "indexer", host: "indexer.ynxweb4.com", path: "/health" },
  { name: "explorer", host: "explorer.ynxweb4.com", path: "/health" },
  { name: "ai", host: "ai.ynxweb4.com", path: "/health" },
  { name: "pay", host: "pay.ynxweb4.com", path: "/health" },
  { name: "trust", host: "trust.ynxweb4.com", path: "/health" },
  { name: "resource", host: "resource.ynxweb4.com", path: "/health" },
];

export function isBenchmarkFakeIPv4(value) {
  const parts = String(value).split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    parts[0] === 198 && (parts[1] === 18 || parts[1] === 19);
}

export function isPublicIPv4(value) {
  if (isIP(value) !== 4 || isBenchmarkFakeIPv4(value)) return false;
  const [first, second] = value.split(".").map(Number);
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && second === 168) return false;
  return true;
}

export function boundedInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function classifyRoute(addresses, originIP = "") {
  if (originIP) {
    return { classification: "explicit-origin-override", directProofEligible: false };
  }
  if (addresses.some(isBenchmarkFakeIPv4)) {
    return { classification: "transparent-proxy-or-vpn-fake-ip", directProofEligible: false };
  }
  if (addresses.length === 0 || addresses.some((address) => !isPublicIPv4(address))) {
    return { classification: "non-public-or-local-address", directProofEligible: false };
  }
  return { classification: "resolved-public-route", directProofEligible: true };
}

function runSelfTest() {
  assert.equal(isBenchmarkFakeIPv4("198.18.0.14"), true);
  assert.equal(isBenchmarkFakeIPv4("198.19.255.254"), true);
  assert.equal(isBenchmarkFakeIPv4("198.20.0.1"), false);
  assert.equal(isBenchmarkFakeIPv4("43.153.202.237"), false);
  assert.equal(isPublicIPv4("43.153.202.237"), true);
  assert.equal(isPublicIPv4("127.0.0.1"), false);
  assert.equal(isPublicIPv4("10.0.0.1"), false);
  assert.equal(isPublicIPv4("100.64.0.1"), false);
  assert.equal(isPublicIPv4("169.254.1.1"), false);
  assert.equal(isPublicIPv4("172.16.0.1"), false);
  assert.equal(isPublicIPv4("192.168.1.1"), false);
  assert.deepEqual(classifyRoute(["198.18.0.14"]), {
    classification: "transparent-proxy-or-vpn-fake-ip",
    directProofEligible: false,
  });
  assert.deepEqual(classifyRoute(["43.153.202.237"]), {
    classification: "resolved-public-route",
    directProofEligible: true,
  });
  assert.deepEqual(classifyRoute(["43.153.202.237"], "43.153.202.237"), {
    classification: "explicit-origin-override",
    directProofEligible: false,
  });
  assert.deepEqual(classifyRoute(["127.0.0.1"]), {
    classification: "non-public-or-local-address",
    directProofEligible: false,
  });
  assert.equal(boundedInteger("3", "cycles", 1, 10), 3);
  assert.throws(() => boundedInteger("11", "cycles", 1, 10), /between 1 and 10/);
  console.log("public-ingress-path-check passed: fake/local DNS and explicit origin overrides cannot be misreported as direct public proof, and diagnostic bounds fail closed");
}

function parseJSON(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function parseTiming(value) {
  const fields = value.trim().split("|");
  if (fields.length !== 7) return null;
  return {
    status: Number(fields[0]),
    remoteIP: fields[1],
    dnsSeconds: Number(fields[2]),
    tcpSeconds: Number(fields[3]),
    tlsSeconds: Number(fields[4]),
    ttfbSeconds: Number(fields[5]),
    totalSeconds: Number(fields[6]),
  };
}

function probe(endpoint, originIP, timeoutSeconds, workDir, cycle) {
  const bodyPath = path.join(workDir, `${cycle}-${endpoint.name}.body`);
  const args = [
    "--connect-timeout", String(Math.min(4, timeoutSeconds)),
    "--max-time", String(timeoutSeconds),
    "--silent", "--show-error",
    "--output", bodyPath,
    "--write-out", "%{http_code}|%{remote_ip}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}",
  ];
  if (originIP) args.push("--resolve", `${endpoint.host}:443:${originIP}`);
  if (endpoint.kind === "evm") {
    args.push(
      "--header", "content-type: application/json",
      "--data", '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
    );
  }
  args.push(`https://${endpoint.host}${endpoint.path}`);

  const startedAt = new Date().toISOString();
  const result = spawnSync("curl", args, {
    encoding: "utf8",
    timeout: (timeoutSeconds + 2) * 1000,
    maxBuffer: 1024 * 1024,
  });
  const body = fs.existsSync(bodyPath) ? fs.readFileSync(bodyPath, "utf8") : "";
  const timing = parseTiming(result.stdout || "");
  const json = parseJSON(body);
  let semanticOK = true;
  let semantic = "HTTP 200";
  if (endpoint.kind === "rpc") {
    semanticOK = Number(json?.chainId) === 6423 && json?.build?.commit === "02f4ccd8770c";
    semantic = `chainId=${json?.chainId ?? "missing"} release=${json?.build?.commit ?? "missing"} height=${json?.height ?? "missing"}`;
  } else if (endpoint.kind === "evm") {
    semanticOK = String(json?.result || "").toLowerCase() === "0x1917";
    semantic = `chainId=${json?.result ?? "missing"}`;
  }
  const transportOK = result.status === 0 && timing?.status === 200;
  return {
    name: endpoint.name,
    host: endpoint.host,
    startedAt,
    ok: Boolean(transportOK && semanticOK),
    curlExit: result.status,
    error: String(result.stderr || "").trim(),
    timing,
    semantic,
    height: endpoint.kind === "rpc" && Number.isInteger(Number(json?.height)) ? Number(json.height) : null,
  };
}

async function main() {
  const cycles = boundedInteger(process.env.YNX_INGRESS_CYCLES || "3", "YNX_INGRESS_CYCLES", 1, 10);
  const timeoutSeconds = boundedInteger(process.env.YNX_INGRESS_TIMEOUT_SECONDS || "8", "YNX_INGRESS_TIMEOUT_SECONDS", 2, 12);
  const originIP = String(process.env.YNX_INGRESS_ORIGIN_IP || "").trim();
  if (originIP && !isPublicIPv4(originIP)) {
    throw new Error("YNX_INGRESS_ORIGIN_IP must be a public IPv4 address");
  }

  const resolved = {};
  for (const endpoint of endpoints) {
    resolved[endpoint.host] = await dns.resolve4(endpoint.host);
  }
  const addresses = [...new Set(Object.values(resolved).flat())];
  const route = classifyRoute(addresses, originIP);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-public-ingress-"));
  const evidencePath = process.env.YNX_INGRESS_EVIDENCE_PATH || path.resolve("tmp/public-ingress-diagnostic/evidence.json");
  const probes = [];
  try {
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      for (const endpoint of endpoints) {
        const result = probe(endpoint, originIP, timeoutSeconds, workDir, cycle);
        probes.push({ cycle, ...result });
        const timing = result.timing;
        console.log(`${result.ok ? "ok" : "FAIL"} cycle=${cycle} ${result.name} ${result.semantic} status=${timing?.status ?? 0} tcp=${timing?.tcpSeconds ?? 0}s tls=${timing?.tlsSeconds ?? 0}s total=${timing?.totalSeconds ?? 0}s${result.error ? ` error=${result.error}` : ""}`);
      }
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const heights = probes.map((item) => item.height).filter(Number.isInteger);
  const blockGrowth = heights.length >= 2 && heights.at(-1) > heights[0];
  const transportAndSemanticOK = probes.every((item) => item.ok);
  const evidence = {
    generatedAt: new Date().toISOString(),
    proofType: "bounded-public-ingress-path-diagnostic",
    cycles,
    timeoutSeconds,
    resolved,
    originIP: originIP || null,
    route,
    observed: {
      transportAndSemanticOK,
      blockGrowth,
      firstHeight: heights[0] ?? null,
      lastHeight: heights.at(-1) ?? null,
      successfulProbes: probes.filter((item) => item.ok).length,
      totalProbes: probes.length,
    },
    probes,
    limitations: route.directProofEligible
      ? ["operator-controlled vantage", "not independent third-party proof"]
      : ["route is not eligible as direct public proof", "operator-controlled vantage", "not independent third-party proof"],
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`route=${route.classification} directProofEligible=${route.directProofEligible} probes=${evidence.observed.successfulProbes}/${evidence.observed.totalProbes} height=${evidence.observed.firstHeight}->${evidence.observed.lastHeight} evidence=${evidencePath}`);

  if (!transportAndSemanticOK || !blockGrowth || !route.directProofEligible) process.exitCode = 1;
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  await main();
}
