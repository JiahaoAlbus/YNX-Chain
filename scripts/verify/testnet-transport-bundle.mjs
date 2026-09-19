// Offline, allowlist-only shareable diagnostics. Never includes raw logs/config/addresses.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {ROUTES, classify} from "./testnet-transport-monitor.mjs";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
const number = v => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const integer = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const date = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|\+00:00)$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
const hash = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v) ? v : null;
const counters = new Set(["ListenOverflows", "ListenDrops", "TCPBacklogDrop", "TCPReqQFullDrop", "TCPReqQFullDoCookies", "SyncookiesSent", "TCPSynRetrans", "TCPTimeouts", "TCPMemoryPressures", "RetransSegs", "AttemptFails", "EstabResets"]);
const counterProjection = x => Object.fromEntries(Object.entries(x ?? {}).filter(([k]) => counters.has(k)).map(([k,v]) => [k,integer(v)]));

export function readRegular(filename, maxBytes) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert(stat.isFile() && stat.nlink === 1 && stat.size <= maxBytes, "unsafe or oversized evidence file");
    const raw = fs.readFileSync(fd, "utf8");
    assert(Buffer.byteLength(raw) <= maxBytes, "evidence grew beyond limit");
    return raw;
  } finally { fs.closeSync(fd); }
}

export function loadRun(directory) {
  assert(path.isAbsolute(directory), "absolute run directory required");
  assert(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), "unsafe run directory");
  const raw = readRegular(path.join(directory,"observations.jsonl"), 16 * 1024 * 1024);
  const summary = JSON.parse(readRegular(path.join(directory,"summary.json"), 262144));
  assert(hash(summary.observationsSHA256) === sha256(raw), "observation hash mismatch");
  const lines = raw.trim().split("\n"); assert(lines.length <= 20000, "too many events");
  const events = lines.map(JSON.parse);
  return {events, summary, inputSHA256: sha256(raw)};
}

export function makeBundle({events, summary, inputSHA256}) {
  const starts = events.filter(e => e.type === "start"), ends = events.filter(e => e.type === "summary");
  assert(starts.length === 1 && ends.length === 1, "incomplete or ambiguous run");
  const start = starts[0];
  assert(/^ynx-probe-[a-f0-9-]{36}$/.test(start.runId) && start.runId === summary.runId && ends[0].runId === start.runId, "invalid run identity");
  assert(/^[a-zA-Z0-9_-]{1,64}$/.test(start.vantage), "invalid public vantage label");
  assert(Number.isInteger(start.rounds) && start.rounds >= 1 && start.rounds <= 120, "invalid expected rounds");
  assert(date(start.at) && date(summary.finishedAt) && Date.parse(summary.finishedAt) >= Date.parse(start.at), "invalid run timestamps");
  const seen = new Set();
  const probes = events.filter(e => e.type === "probe").map(p => {
    assert(ROUTES.some(r => r.url === p.url) && Number.isInteger(p.round) && p.round > 0 && p.round <= start.rounds, "unexpected probe target or round");
    const key = p.round + " " + p.url;
    assert(!seen.has(key), "duplicate probe target in round"); seen.add(key);
    const fields = ["time_namelookup", "time_connect", "time_appconnect", "time_starttransfer", "time_total", "http_code", "exitcode", "ssl_verify_result", "proxy_used"];
    const client = Object.fromEntries(fields.map(k => [k,number(p.client?.[k])]));
    const validatedReady=p.ready===true&&client.exitcode===0&&client.http_code===200&&client.ssl_verify_result===0&&client.time_appconnect>0
      &&p.identity?.chainId===6423&&p.identity?.nativeSymbol==="YNXT"&&integer(p.identity?.height)>0&&/^[a-f0-9]{40}$/.test(p.identity?.build?.commit??"");
    const classification = classify(client, client.exitcode ?? 1, validatedReady);
    const ready = validatedReady && classification === "healthy";
    return {round:p.round, url:p.url, startedAt:date(p.startedAt), finishedAt:date(p.finishedAt), ready, classification, client,
      remoteIsExpectedOrigin:p.client?.remote_ip === "43.153.202.237", bodySHA256:hash(p.bodySHA256),
      chainId:integer(p.identity?.chainId), height:integer(p.identity?.height),
      buildCommit:/^[a-f0-9]{40}$/.test(p.identity?.build?.commit ?? "") ? p.identity.build.commit : null};
  });
  const pathMode = ["environment-dns","direct-dns","pinned-public-origin"].includes(start.pathMode) ? start.pathMode : "environment-dns";
  const hosts = events.filter(e => e.type === "host-window").map(w => {
    const details = w.host?.details, firewall = details?.firewall;
    return {round:integer(w.round), available:Array.isArray(w.host?.samples) && w.host.samples.length >= 2,
      coverage:(w.coverage ?? []).map(c => ({failure:c.failure === true,clientWindowCovered:c.clientWindowCovered === true})),
      withinWindowDelta:counterProjection(w.withinWindowDelta), countersAreHostWide:true,
      samples:(w.host?.samples ?? []).slice(0,16).map(s => ({at:date(s.observedAt),counters:counterProjection(s.tcpCounters),
        listeners:(s.listeners ?? []).slice(0,20).map(l => ({port:[80,443,6420,6428].find(p => String(l.local).endsWith(":"+p)) ?? null,recvQ:integer(l.recvQ),backlog:integer(l.backlog)}))})),
      caddyfileSHA256:hash(details?.caddyfileSHA256?.output?.split(" ")[0]),
      conntrack:details?.conntrack ? {count:integer(details.conntrack.nf_conntrack_count),max:integer(details.conntrack.nf_conntrack_max)} : null,
      firewall:firewall ? {available:firewall.available === true,ruleCount:integer(firewall.ruleCount),
        dropRules:(firewall.terminalRules ?? []).filter(r => r.verdict === "drop" || r.verdict === "reject").map(r => ({packets:integer(r.counter?.packets),bytes:integer(r.counter?.bytes),explicitSingleDport443Match:r.explicitSingleDport443Match === true})),nftOnly:true,cloudFirewallVisible:false} : null,
      packetMetadata:w.host?.packetMetadata ? {available:w.host.packetMetadata.available === true,packetLimitReached:w.host.packetMetadata.packetLimitReached === true,
        events:(w.host.packetMetadata.events ?? []).slice(0,120).map(e => ({timestamp:typeof e.timestamp === "string" && /^\d{10}\.\d{1,9}$/.test(e.timestamp) ? e.timestamp : null,
          direction:["from-client","to-client"].includes(e.direction) ? e.direction : null,clientPort:integer(e.clientPort),
          flags:typeof e.flags === "string" && /^[FSRPAUEW.]{1,9}$/.test(e.flags) ? e.flags : null,
          sequence:typeof e.sequence === "string" && /^\d{1,10}(?::\d{1,10})?$/.test(e.sequence) ? e.sequence : null,
          ack:typeof e.ack === "string" && /^\d{1,10}$/.test(e.ack) ? e.ack : null,length:integer(e.length)})),clientAddressesAndHashesRetained:false} : null};
  });
  const complete = summary.interrupted !== true && ends[0].interrupted !== true && probes.length === start.rounds * ROUTES.length
    && probes.every(p => p.startedAt && p.finishedAt && Date.parse(p.startedAt)>=Date.parse(start.at)
      && Date.parse(p.finishedAt)>=Date.parse(p.startedAt) && Date.parse(p.finishedAt)<=Date.parse(summary.finishedAt));
  return {schema:"ynx-transport-shareable-bundle/v1",runId:start.runId,vantage:start.vantage,pathMode,
    startedAt:start.at,finishedAt:summary.finishedAt,inputSHA256:hash(inputSHA256),
    sanitizerSHA256:sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
    sourceSHA256:Object.fromEntries(Object.entries(start.sourceSHA256 ?? {}).filter(([k,v]) => ["testnet-transport-monitor.mjs","testnet-transport-host-snapshot.py","testnet-alias-preflight.mjs"].includes(k) && hash(v))),
    complete,hostObservationExpected:start.hostObservationEnabled===true,expectedRounds:start.rounds,
    expectedSamples:start.rounds*ROUTES.length,observedSamples:probes.length,healthySamples:probes.filter(p=>p.ready).length,
    allSamplesHealthy:complete && probes.every(p=>p.ready),probes,hosts,
    redaction:{allowlistOnly:true,rawBodies:false,rawHeaders:false,rawErrors:false,rawConfiguration:false,rawLogs:false,clientAddresses:false,clientAddressHashes:false,localPaths:false,privateKeys:false},
    sourceAuthenticityVerified:false,independentNetworkPathProven:false,globalRegionalVerified:false,continuousAvailabilityVerified:false,rootCauseConfirmed:false};
}

export function writeBundle(directory, output) {
  assert(path.isAbsolute(output), "absolute bundle output required");
  const bundle = makeBundle(loadRun(directory));
  fs.writeFileSync(output, JSON.stringify(bundle,null,2)+"\n", {flag:"wx",mode:0o600});
  return bundle;
}

if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 6 && process.argv[2] === "--input-dir" && process.argv[4] === "--output", "usage: --input-dir ABS --output ABS_NEW_JSON");
  const result = writeBundle(process.argv[3],process.argv[5]);
  console.log(JSON.stringify({runId:result.runId,complete:result.complete,healthy:result.healthySamples,total:result.observedSamples,redacted:true}));
}
