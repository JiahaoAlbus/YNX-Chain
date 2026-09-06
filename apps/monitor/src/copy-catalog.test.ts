import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { copyCatalog, copyAliases } from './copy-catalog';

const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'id'] as const;
// Frozen visible-text inventory before translation.
const requiredStaticKeys = [
  "(",
  ")",
  "; failure and recovery transitions use accepted signed snapshots only.",
  "A proposal never executes rollback. Central infrastructure ownership remains required after explicit operator approval.",
  "AI evidence summary",
  "Acknowledge",
  "Alerts",
  "Alerts appear only after a real upstream probe fails. Empty is a healthy, honest state.",
  "Allow context once & stream",
  "Append-first operator evidence",
  "Approve proposal only",
  "As of",
  "Assign",
  "Attention queue",
  "Audit",
  "Authenticate to inspect nodes, validators, alerts, incidents, release identity and audit. Operator actions require an explicit approval phrase.",
  "Authenticated activity will appear here.",
  "Authenticated live probes",
  "Authority",
  "Backup artifact hash or verified location",
  "Backups",
  "Bounded and redacted",
  "Bounded configured endpoint",
  "Bounded probe completed",
  "Canonical network evidence",
  "Checked",
  "Close AI incident summary",
  "Complete postmortem",
  "Consensus status: StreamBFT is a shadow/candidate and is not reported as active consensus.",
  "Control plane unavailable",
  "Corrective action",
  "Current SLO checks",
  "Current probes",
  "Current service evidence",
  "Dependencies",
  "Estimated cost",
  "Evidence",
  "Evidence register",
  "Evidence source",
  "Explicit phrase",
  "Export evidence",
  "Finality & throughput",
  "Firing alerts",
  "From /status",
  "Human approval boundary",
  "Identity",
  "Incidents",
  "Incidents & alerts",
  "Infrastructure execution remains outside this product",
  "Inspect nodes →",
  "Loading operational evidence",
  "Monitor records verified backup evidence; it does not claim or execute a backup.",
  "Monitor views",
  "No acknowledge, restart, key rotation, rollback or state mutation",
  "No alerts observed",
  "No audit events",
  "No backup evidence recorded",
  "No historical uptime inferred",
  "No incident is created from a template or synthetic alert. Operators may record one with exact source evidence.",
  "No incidents recorded",
  "No log sources configured",
  "No peer records returned",
  "No peer-sync records returned",
  "No record is fabricated for presentation.",
  "No rollback proposal recorded",
  "No validator records returned",
  "Node surfaces",
  "Non-secret binary identity",
  "OPERATIONS /",
  "Observed failures only",
  "On-call owner",
  "One bounded incident summary",
  "Only server-side allowlisted sources can be read.",
  "Open incidents",
  "Operator identity",
  "Operator-owned case log",
  "Operator: record and approve bounded workflow state",
  "Owner",
  "PUBLIC TESTNET STATUS",
  "Passing now",
  "Peer discovery",
  "Peer sync",
  "Permissioned YNX AI Gateway",
  "Persisted operator records",
  "Postmortem summary",
  "Probe matrix",
  "Probe-derived attention",
  "Probing authenticated upstreams…",
  "Process-scoped service trend",
  "Proposed runbook steps require independent operator review and the existing approval boundary. Nothing was executed.",
  "Provider",
  "Reason",
  "Record evidence",
  "Record incident",
  "Record with audit",
  "Reject result",
  "Release",
  "Release control",
  "Release evidence",
  "Retry",
  "Rollback proposals",
  "Root cause",
  "Schema v",
  "Select a configured log source",
  "Selected context",
  "Service details",
  "Service logs",
  "Set the server-side YNX_MONITOR_LOG_SOURCES allowlist. No browser-side placeholder logs are generated.",
  "Severity",
  "Source",
  "Source height",
  "Started",
  "Streaming evidence-grounded proposal…",
  "The current authenticated upstream returned an empty collection.",
  "This view reports upstream identity. It does not infer that a release was independently audited or deployed everywhere.",
  "Title",
  "Total incidents",
  "Transition summary",
  "Trend retention:",
  "Truthful service-level evidence",
  "Type ACKNOWLEDGE",
  "URL or audit reference",
  "URL, hash or audit reference",
  "Upstream response",
  "Validator evidence",
  "Viewer: inspect current evidence",
  "What changed and why",
  "YNX AI · advisory only",
  "bounded probes passing at the recorded check time",
  "critical",
  "high",
  "low",
  "medium",
  "timeline entries",
  "· process health and owner facts remain separate."
];

test('all visible static keys have twelve real translations', () => {
  for (const key of requiredStaticKeys) assert.ok(copyCatalog[key], `Missing static copy: ${key}`);
  const scripts = { 'zh-CN': /[\u3400-\u9fff]/u, 'zh-TW': /[\u3400-\u9fff]/u,
    ja: /[\u3040-\u30ff\u3400-\u9fff]/u, ko: /[\uac00-\ud7af]/u,
    ru: /[\u0400-\u04ff]/u, ar: /[\u0600-\u06ff]/u };
  for (const [key, entry] of Object.entries(copyCatalog)) {
    assert.deepEqual(Object.keys(entry), locales, `${key}: exact twelve-locale coverage`);
    assert.equal(entry.en, key, `${key}: English key preserves exact source`);
    for (const locale of locales) {
      assert.ok(entry[locale].trim(), `${key}/${locale}: empty translation`);
      assert.doesNotMatch(entry[locale], /\b(?:TODO|FIXME|TRANSLATE_ME|PLACEHOLDER)\b/, `${key}/${locale}`);
    }
    if (['(', ')'].includes(key)) continue;
    assert.ok(locales.slice(1).some(locale => entry[locale] !== key), `${key}: blanket English fallback`);
    for (const [locale, pattern] of Object.entries(scripts)) assert.match(entry[locale as keyof typeof scripts], pattern, `${key}/${locale}: target script missing`);
  }
});

test('aliases resolve to full entries and exclude protocol constants', () => {
  for (const [alias, key] of Object.entries(copyAliases)) {
    assert.ok(copyCatalog[key], `${alias}: missing target ${key}`);
    assert.notEqual(alias, key, `${alias}: unnecessary self alias`);
  }
  for (const key of ['operational','available','healthy','unavailable','checking','degraded','maintenance','partial_outage','major_outage','unknown',
    'open','acknowledged','investigating','mitigated','recovery_verifying','resolved','postmortem_complete','process-scoped',
    'sourceCommit','canonicalHeight','indexedHeight','indexLag','blockIntervalSeconds','tps','peerCount','httpStatus','latencyMs']) assert.ok(copyAliases[key], `Missing dynamic alias: ${key}`);
  for (const key of ['POST','ACKNOWLEDGE','APPROVE ROLLBACK PROPOSAL','Content-Type','X-YNX-CSRF-Token',
    'alert:acknowledge','rollback:propose','/status','0x1917','YNX Wallet','MetaMask']) {
    assert.equal(copyCatalog[key], undefined, `${key}: protocol or brand must stay raw`);
    assert.equal(copyAliases[key], undefined, `${key}: protocol or brand must not be aliased`);
  }
  for (const locale of locales) assert.ok(copyCatalog['Type ACKNOWLEDGE'][locale].includes('ACKNOWLEDGE'));
});

test('actual public messages, source truth and backup limitations are covered', () => {
  const publisher = readFileSync(new URL('../scripts/publish-public-status.mjs', import.meta.url), 'utf8');
  const messages = [...publisher.matchAll(/"((?:Configured public HTTPS|A configured dependency|All configured public Testnet|One or more configured public Testnet)[^"]+)"/g)].map(match => match[1]);
  assert.equal(messages.length, 5);
  for (const message of messages) assert.ok(copyCatalog[message], `Public publisher message missing: ${message}`);
  for (const key of ['StreamBFT remains a shadow/candidate and is not reported as active consensus.',
    'Current bounded endpoint availability only; no historical uptime is inferred.', 'Backup details required', 'Required backup details',
    'Record creation is unavailable until the artifact, digest, size, retention, encryption, recovery targets and evidence are supplied.']) assert.ok(copyCatalog[key], key);
  const source = readFileSync(new URL('./copy-catalog.ts', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/^\['([^']*)'/gm)].map(match => match[1]);
  assert.equal(keys.length, new Set(keys).size, 'Duplicate rows would silently overwrite earlier translations');
  assert.equal(keys.length, Object.keys(copyCatalog).length);
  assert.doesNotMatch(source, /^import(?! type )/m, 'Catalog has no runtime dependency on locale hooks');
});
