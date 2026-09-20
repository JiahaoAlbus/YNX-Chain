import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createHash, randomUUID, randomInt} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {interpretProbe} from "./testnet-alias-preflight.mjs";
import {clientPathSnapshot} from "./testnet-transport-client-path.mjs";

export const ROUTES = [
  ["legacy", "rpc", "https://rpc.ynxweb4.com/status"],
  ["canonical", "rpc", "https://rpc-testnet.ynxweb4.com/status"],
  ["legacy", "faucet", "https://faucet.ynxweb4.com/health"],
  ["canonical", "faucet", "https://faucet-testnet.ynxweb4.com/health"],
].map(([role, kind, url]) => ({role, kind, url, origin: null}));
const MARKER = "\n__YNX_CURL_METADATA__";
const MAX_BYTES = 1048576;
const HOST_SCRIPT = new URL("./testnet-transport-host-snapshot.py", import.meta.url);
const now = () => new Date().toISOString();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function sourceIdentity() {
  return Object.fromEntries(["testnet-transport-monitor.mjs", "testnet-transport-host-snapshot.py", "testnet-alias-preflight.mjs", "testnet-transport-client-path.mjs"].map(name =>
    [name, createHash("sha256").update(fs.readFileSync(new URL(name, import.meta.url))).digest("hex")]));
}

export function parseArgs(argv) {
  const out = {live: false, packetMetadata: false, pinOrigin: false, direct: false, rounds: 4, intervalSeconds: 30, vantage: "local-unspecified", host: null, identity: null, knownHosts: null, outputDir: null};
  const names = {"--rounds": "rounds", "--interval-seconds": "intervalSeconds", "--vantage": "vantage", "--host": "host", "--identity": "identity", "--known-hosts": "knownHosts", "--output-dir": "outputDir"};
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    assert(!seen.has(arg), "duplicate option"); seen.add(arg);
    if (arg === "--live") { out.live = true; continue; }
    if (arg === "--packet-metadata") { out.packetMetadata = true; continue; }
    if (arg === "--pin-origin") { out.pinOrigin = true; out.direct = true; continue; }
    if (arg === "--direct") { out.direct = true; continue; }
    assert(names[arg] && argv[i + 1] && !argv[i + 1].startsWith("--"), "unknown option or missing value");
    out[names[arg]] = argv[++i];
  }
  out.rounds = Number(out.rounds); out.intervalSeconds = Number(out.intervalSeconds);
  assert(Number.isInteger(out.rounds) && out.rounds >= 1 && out.rounds <= 120, "rounds must be 1..120");
  assert(Number.isInteger(out.intervalSeconds) && out.intervalSeconds >= 15 && out.intervalSeconds <= 300, "interval must be 15..300 seconds");
  assert(out.rounds * out.intervalSeconds <= 7200, "maximum scheduled window is two hours");
  assert(/^[a-zA-Z0-9_-]{1,64}$/.test(out.vantage), "vantage must be a non-sensitive label");
  assert(out.host === null || out.host === "ubuntu@43.153.202.237", "only the authorized primary host is supported");
  for (const key of ["identity", "knownHosts", "outputDir"]) if (out[key] !== null) assert(path.isAbsolute(out[key]) && !/[\r\n\0]/.test(out[key]), "absolute safe path required");
  assert(!out.identity || out.host, "identity requires host");
  assert(!out.knownHosts || out.host, "known-hosts requires host");
  assert(!out.packetMetadata || out.host, "packet metadata requires host");
  assert(!out.live || out.outputDir, "live mode requires a new output directory");
  return out;
}

export function curlArgs(route, probeId, localPort = null, options = {}) {
  assert(ROUTES.some(r => r.url === route.url), "route not allowlisted");
  assert(/^ynx-probe-[a-zA-Z0-9_-]{1,100}$/.test(probeId), "invalid probe identifier");
  assert(localPort === null || (Number.isInteger(localPort) && localPort >= 20000 && localPort <= 65000), "invalid local probe port");
  return ["--disable", "--silent", "--show-error", "--proto", "=https", "--request", "GET",
    "--connect-timeout", "5", "--max-time", "8", "--max-filesize", String(MAX_BYTES),
    "--header", `X-YNX-Probe-ID: ${probeId}`, "--dump-header", "/dev/stderr",
    "--write-out", MARKER + "%{json}", ...(localPort === null ? [] : ["--local-port", String(localPort)]),
    ...(options.direct || options.pinOrigin ? ["--noproxy", "*"] : []),
    ...(options.pinOrigin ? ["--resolve", new URL(route.url).hostname + ":443:43.153.202.237"] : []), route.url];
}

export function runCommand(command, args, {input, onStdout, timeout = 10000, maxBuffer = MAX_BYTES + 131072} = {}) {
  return new Promise(resolve => {
    const child = execFile(command, args, {timeout, maxBuffer, encoding: "utf8"}, (error, stdout, stderr) => resolve({
      exitCode: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
      killed: !!error?.killed, signal: error?.signal ?? null, stdout, stderr,
    }));
    child.stdin?.on("error", () => {});
    if (onStdout) child.stdout?.on("data", onStdout);
    child.stdin?.end(input);
  });
}

export function classify(meta, exitCode, ready) {
  const code = exitCode || Number(meta.exitcode) || 0;
  if (code === 6) return "dns-resolution-failed";
  if ([51, 60, 77, 83].includes(code)) return "tls-verification-failed";
  if (code === 35) return "tls-handshake-failed";
  if (code === 28) {
    if (!(meta.time_namelookup > 0)) return "connection-timeout-dns-or-connect-unresolved";
    if (!(meta.time_connect > 0)) return "tcp-connect-timeout";
    if (!(meta.time_appconnect > 0)) return "tls-handshake-timeout";
    return meta.time_starttransfer > 0 ? "response-body-timeout" : "http-first-byte-timeout";
  }
  if (code === 7) return "tcp-connect-failed";
  if (code === 45) return "client-source-port-unavailable";
  if (code) return "transport-or-client-error";
  if (Number(meta.ssl_verify_result) > 0) return "tls-verification-failed";
  if (meta.http_code >= 500) return "http-server-or-upstream-error";
  if (meta.http_code !== 200) return "http-unexpected-status";
  return ready ? "healthy" : "service-identity-or-readiness-failed";
}

export function interpret(route, raw, probeId, startedAt) {
  const cut = raw.stdout.lastIndexOf(MARKER);
  let meta = {};
  try { meta = JSON.parse(raw.stdout.slice(cut + MARKER.length)); } catch { /* explicit missing evidence below */ }
  const base = interpretProbe(route, raw);
  const body = cut < 0 ? "" : raw.stdout.slice(0, cut);
  const headers = {};
  for (const line of raw.stderr.split(/\r?\n/)) {
    const match = line.match(/^(server|content-type|via|retry-after|x-request-id):\s*(.*)$/i);
    if (match) headers[match[1].toLowerCase()] = match[2].slice(0, 200);
  }
  let health = {};
  try {
    const value = JSON.parse(body);
    for (const key of ["probeDurationMs", "statusDurationMs", "capabilityDurationMs", "failureStage", "upstreamOk", "fundingReady", "checkedAt"])
      if (value[key] !== undefined) health[key] = value[key];
  } catch { /* raw body deliberately not retained */ }
  const fields = ["time_namelookup", "time_connect", "time_appconnect", "time_pretransfer", "time_starttransfer", "time_total", "remote_ip", "local_port", "remote_port", "http_version", "http_code", "num_connects", "num_redirects", "ssl_verify_result", "proxy_used", "exitcode"];
  const result = {...base, probeId, startedAt, finishedAt: now(),
    classification: cut < 0 ? "client-metadata-unavailable" : classify(meta, raw.exitCode, base.ready),
    client: Object.fromEntries(fields.map(k => [k, meta[k] ?? null])), headers, health,
    clientError: typeof meta.errormsg === "string" ? meta.errormsg.replace(/[\r\n]/g, " ").slice(0, 400) : null,
    processKilled: !!raw.killed, rawBodyRetained: false, rawHeadersRetained: false};
  const difference = (a, b) => meta[a] > 0 && Number.isFinite(meta[b]) && (b === "time_namelookup" || meta[b] > 0) ? Math.max(0, meta[a] - meta[b]) : null;
  result.phaseSeconds = {dns: meta.time_namelookup ?? null, tcpAfterDNS: difference("time_connect", "time_namelookup"), tlsAfterTCP: difference("time_appconnect", "time_connect"), firstByteAfterTLS: difference("time_starttransfer", "time_appconnect"), bodyAfterFirstByte: difference("time_total", "time_starttransfer")};
  return result;
}

export async function dnsSnapshot(host, exec = runCommand) {
  assert(ROUTES.some(r => new URL(r.url).hostname === host), "DNS host not allowlisted");
  const startedAt = now();
  // A separate killed child bounds OS getaddrinfo too, not only c-ares promises.
  const code = `import dns from 'node:dns/promises'; const host=process.argv[1]; const r=new dns.Resolver({timeout:750,tries:1}); const v=await Promise.allSettled([dns.lookup(host,{all:true}),r.resolve4(host,{ttl:true}),r.resolve6(host,{ttl:true})]); console.log(JSON.stringify(v.map((x,i)=>({kind:['system-lookup','resolver-A','resolver-AAAA'][i],...(x.status==='fulfilled'?{value:x.value}:{errorCode:x.reason?.code??'UNKNOWN'})}))));`;
  const raw = await exec(process.execPath, ["--input-type=module", "-e", code, host], {timeout: 2500, maxBuffer: 32768});
  let answers = [];
  try { answers = JSON.parse(raw.stdout); } catch { /* not a successful DNS sample */ }
  return {host, startedAt, finishedAt: now(), semantics: "separate DNS sample; not proof of curl's resolver path",
    timedOut: !!raw.killed, exitCode: raw.exitCode, answers};
}

export function hostArgs(options, details = false) {
  assert(options.host === "ubuntu@43.153.202.237", "unauthorized host");
  const args = ["-o", "StrictHostKeyChecking=yes", "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ConnectionAttempts=1"];
  if (options.knownHosts) args.push("-o", "UserKnownHostsFile=" + options.knownHosts);
  if (options.identity) args.push("-i", options.identity);
  args.push(options.host, "python3", "-", "--samples", "8", "--interval", "3");
  if (details) args.push("--details");
  if (options.packetMetadata) args.push("--packet-metadata");
  if (options.probePorts) {
    assert(options.probePorts.length === 4 && options.probePorts.every(p => Number.isInteger(p) && p >= 20000 && p <= 65000), "invalid planned probe ports");
    args.push("--probe-ports", options.probePorts.join(","));
  }
  return args;
}

export function counterDelta(before, after) {
  const result = {};
  for (const [key, value] of Object.entries(before ?? {})) if (Number.isSafeInteger(value) && Number.isSafeInteger(after?.[key]))
    result[key] = after[key] >= value ? after[key] - value : null;
  return result;
}

export async function monitor(options, deps = {}) {
  const exec = deps.exec ?? runCommand, resolveDNS = deps.resolveDNS ?? dnsSnapshot;
  const emit = deps.emit ?? (() => {}), sleep = deps.sleep ?? pause, clock = deps.clock ?? Date.now;
  const hostScript = options.host ? (deps.hostScript ?? fs.readFileSync(HOST_SCRIPT, "utf8")) : null;
  const runId = "ynx-probe-" + randomUUID(), portBase = randomInt(20000, 48000);
  const clientPath = deps.clientPath ?? (deps.exec ? {available:false,reason:"injected executor; no implicit local diagnostics"} : await clientPathSnapshot(exec));
  const failures = [], rounds = [], hostWindows = []; let previousCounters = null;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  emit({type: "start", at: now(), runId, vantage: options.vantage, rounds: options.rounds, intervalSeconds: options.intervalSeconds,
    requestsPerRound: 4, maxClientConcurrency: 2, noClaimsOrTransactions: true, readOnly: true,
    sourceSHA256: sourceIdentity(),
    clientPath,
    pathMode: options.pinOrigin ? "pinned-public-origin" : options.direct ? "direct-dns" : "environment-dns",
    independentNetworkPathProven: false,
    proxyEnvironmentPresent: ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"].some(k => !!process.env[k]),
    hostObservationEnabled: !!options.host});
  try {
    for (let round = 1; round <= options.rounds && !stopping; round++) {
      const roundStart = clock();
      const probePorts = options.packetMetadata ? ROUTES.map((_, i) => portBase + round * 4 + i) : null;
      // Start server sampling while client requests are in flight, not only after failures.
      let signalReady, readyBuffer = "", readyTimer;
      const readyPromise = new Promise(resolve => { signalReady = resolve; });
      const hostPromise = options.host ? exec("ssh", hostArgs({...options, probePorts}, round === 1 || round === options.rounds), {
        input: hostScript, timeout: 80000, maxBuffer: 1048576,
        onStdout: chunk => { readyBuffer += chunk; if (readyBuffer.includes('"type": "host-ready"')) signalReady(true); },
      }) : null;
      if (hostPromise) {
        hostPromise.then(() => signalReady(false));
        const samplerReady = await Promise.race([readyPromise, new Promise(resolve => { readyTimer = setTimeout(() => resolve(false), 20000); })]);
        clearTimeout(readyTimer); emit({type: "host-ready-status", round, at: now(), samplerReady});
      }
      const observations = []; let index = 0;
      await Promise.all([0, 1].map(async () => {
        while (index < ROUTES.length && !stopping) {
          const routeIndex = index++, route = ROUTES[routeIndex], probeId = `${runId}-${round}-${route.kind}-${route.role}`;
          const dnsObservation = await resolveDNS(new URL(route.url).hostname);
          const startedAt = now(), raw = await exec("curl", curlArgs(route, probeId, probePorts?.[routeIndex] ?? null, options));
          const checkedRoute = options.pinOrigin ? {...route, origin: "43.153.202.237"} : route;
          const observation = {...interpret(checkedRoute, raw, probeId, startedAt), plannedLocalPort: probePorts?.[routeIndex] ?? null, dns: dnsObservation};
          observations.push(observation); emit({type: "probe", round, ...observation});
          if (!observation.ready) failures.push({round, probeId, classification: observation.classification});
        }
      }));
      if (hostPromise) {
        const raw = await hostPromise;
        let host;
        try { host = JSON.parse(raw.stdout.trim().split("\n").at(-1)); } catch { host = {available: false, exitCode: raw.exitCode, reason: "SSH or collector output unavailable; no remote service change attempted"}; }
        const first = host.samples?.[0]?.tcpCounters, last = host.samples?.at(-1)?.tcpCounters;
        const sampleStart = Date.parse(host.samples?.[0]?.observedAt), sampleEnd = Date.parse(host.samples?.at(-1)?.observedAt);
        const coverage = observations.map(o => ({probeId: o.probeId, failure: !o.ready,
          clientWindowCovered: Number.isFinite(sampleStart) && Number.isFinite(sampleEnd) && sampleStart <= Date.parse(o.startedAt) && sampleEnd >= Date.parse(o.finishedAt)}));
        const event = {type: "host-window", round, at: now(), host, withinWindowDelta: counterDelta(first, last), sincePreviousWindowDelta: counterDelta(previousCounters, first), coverage, clockSkewNotCorrected: true, countersAreHostWide: true, requestFlowAttributionProven: false};
        hostWindows.push({round, available: raw.exitCode === 0 && host.samples?.length >= 2,
          allClientWindowsCovered: coverage.length > 0 && coverage.every(c => c.clientWindowCovered),
          packetMetadataAvailable: host.packetMetadata?.available === true});
        emit(event); previousCounters = last ?? previousCounters;
      }
      const result = {round, at: now(), attempted: observations.length, healthy: observations.filter(x => x.ready).length, failed: observations.filter(x => !x.ready).length};
      rounds.push(result); emit({type: "round", ...result});
      if (round < options.rounds && !stopping) await sleep(Math.max(0, options.intervalSeconds * 1000 - (clock() - roundStart)));
    }
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  }
  const summary = {schema: "ynx-testnet-transport-monitor/v1", runId, finishedAt: now(), vantage: options.vantage,
    rounds, failures, hostWindows, interrupted: stopping, allSamplesHealthy: !stopping && rounds.length === options.rounds && failures.length === 0,
    rootCauseConfirmed: false, continuousAvailabilityVerified: false, globalRegionalVerified: false,
    serviceChanges: 0, faucetClaims: 0, transactionSubmissions: 0};
  emit({type: "summary", ...summary}); return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (!options.live) console.log(JSON.stringify({dryRun: true, networkRequests: 0, routes: ROUTES, rounds: options.rounds, intervalSeconds: options.intervalSeconds, hostObservationEnabled: !!options.host}));
  else {
    // Exclusive leaf directory/files: no existing-output reuse or unbounded append log.
    fs.mkdirSync(options.outputDir, {mode: 0o700});
    const filename = path.join(options.outputDir, "observations.jsonl");
    const fd = fs.openSync(filename, "wx", 0o600);
    try {
      const emit = event => { fs.writeSync(fd, JSON.stringify(event) + "\n"); fs.fsyncSync(fd); if (["round", "summary"].includes(event.type)) console.log(JSON.stringify(event)); };
      const summary = await monitor(options, {emit});
      fs.writeFileSync(path.join(options.outputDir, "summary.json"), JSON.stringify({...summary,
        observationsSHA256: createHash("sha256").update(fs.readFileSync(filename)).digest("hex")}, null, 2) + "\n", {flag: "wx", mode: 0o600});
      if (!summary.allSamplesHealthy) process.exitCode = 2;
    } finally { fs.closeSync(fd); }
  }
}
