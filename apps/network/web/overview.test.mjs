import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('./overview.js', import.meta.url), 'utf8');
function projector(extra = {}) {
  const sandbox = { window: {}, URL, fetch() { throw Error('projection must not fetch'); }, ...extra };
  vm.runInNewContext(script, sandbox, { filename: 'overview.js', timeout: 1000 });
  assert.equal(Object.isFrozen(sandbox.window.NetworkOverview), true);
  return (...args) => JSON.parse(JSON.stringify(sandbox.window.NetworkOverview.project(...args)));
}
const project = projector();
const H = 'c9b6cdfebca7bea09b2dca37ddf9f2a05b9266aecbadde9bd265733d8e164056';
const P = 'c3adbc5a9ad90207f0ef8f25815bb5a00845e79e26a10d3aa1001cfedf6c3f5c';
const TIME = '2026-10-31T16:32:16.127486172Z';
const reported = data => ({ status: 'reported', data });
function node(status = {}, block = {}, validators = []) {
  return { classification: 'RPC_ONLY', source: 'https://rpc.ynxweb4.com', reports: {
    status: reported(status), latestBlock: reported(block), validators: reported({ validators })
  } };
}
function native(status = { service: 'YNX Network', nodeControl: 'unavailable', resourceContribution: 'disabled' }) {
  return { browserIdentityVerified: false, native: { version: 'YNX-NETWORK-LOCAL-IPC/v1', code: 'OK',
    peer: { uid: 501, pid: 123, credentialSource: 'darwin-LOCAL_PEERCRED-Xucred', nativeIPCVerified: true, browserIdentityVerified: false },
    result: { status } } };
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// Reduced from the actual public GET readback on 2026-11-01 Shanghai time.
// Original three raw bodies + SHA256 are retained in design-20261101 artifacts.
// These are one RPC's reports, not testnet finality or independent checkpoints.
test('actual fixed RPC shapes project one status, one block and four reported validators', () => {
  const report = node({ network: 'YNX Testnet', chainId: 6423, height: 2060705, latestBlockHash: H,
    latestBlockTime: TIME, validatorCount: 4, readyValidatorCount: 4, pendingTxCount: 0, catchingUp: false,
    nodeIdentity: { blockProductionEnabled: true, peerSyncTargetCount: 3 }, validatorPeerSync: { synced: 3 } },
  { height: 2060705, hash: H, parentHash: P, time: TIME, validator: 'ynx_validator_primary', transactions: null },
  ['primary', 'singapore', 'silicon_valley', 'seoul'].map(name => ({ address: 'ynx_validator_' + name, moniker: 'ynx-' + name, votingPower: 1, active: true })));
  const out = project(report, native());
  assert.equal(out.classification, 'RPC_ONLY'); assert.equal(out.authority, false);
  assert.equal(out.source, report.source); assert.equal(out.status.network, 'YNX Testnet');
  assert.equal(out.status.chainId, '6423'); assert.equal(out.status.height, '2060705');
  assert.equal(out.status.pendingTxCount, '0'); assert.equal(out.status.catchingUp, false);
  assert.equal(out.latestBlock.height, '2060705'); assert.equal(out.latestBlock.time, TIME);
  assert.equal(out.latestBlock.transactionCount, null); // null is not an empty list.
  assert.equal(out.validators.count, '4'); assert.equal(out.validators.votingPowerTotal, '4');
  assert.deepEqual(out.validators.distribution.map(row => row.shareBps), [2500, 2500, 2500, 2500]);
  assert.equal(out.native.scope, 'helper-self-diagnostic'); assert.equal(out.native.nodeControl, 'unavailable');
  assert.equal(out.native.resourceContribution, 'disabled'); assert.equal(out.native.participation, null);
  assert.equal(out.native.peer.credentialSource, 'darwin-LOCAL_PEERCRED-Xucred');
  assert.equal(out.native.browserIdentityVerified, false); assert.equal(out.native.authority, false);
  assert.deepEqual(Object.keys(out), ['classification', 'authority', 'source', 'reports', 'status', 'latestBlock', 'recentBlocks', 'metrics', 'recentTransactions', 'transactionListsComplete', 'receivedAt', 'statusLatencyMicros', 'validators', 'native']);
  assert.equal('sources' in out, false); assert.equal('sourceCount' in out, false); assert.deepEqual(out.recentBlocks, []); assert.equal(out.metrics,null);
  assert.equal('synced' in out.status, false); assert.equal('peers' in out.status, false); assert.equal('nodeIdentity' in out.status, false);
});

test('absent, invalid and wrong-classification input stays RPC_ONLY with explicit missing models', () => {
  for (const input of [undefined, null, false, [], 1, 'rpc', {}, { classification: 'STATE_VERIFIED', reports: node().reports }]) {
    const out = project(input, null);
    assert.equal(out.classification, 'RPC_ONLY'); assert.equal(out.authority, false);
    assert.equal(out.source, null); assert.equal(out.status, null); assert.equal(out.latestBlock, null);
    assert.equal(out.validators, null); assert.equal(out.native, null);
    assert.equal(out.reports.status.status, 'unavailable');
  }
});

test('reported object with missing fields never creates zero metrics or unknown block rows', () => {
  const out = project(node({}, {}, []));
  assert.ok(Object.values(out.status).every(value => value === null));
  assert.equal(out.latestBlock, null); assert.equal(out.reports.latestBlock.code, 'BLOCK_HEIGHT_NOT_BOUND');
  assert.equal(out.validators.count, '0'); assert.equal(out.validators.votingPowerTotal, '0');
  assert.equal(out.validators.distribution, null); assert.equal(out.validators.distributionReason, 'ZERO_VOTING_POWER');
});

test('all legitimate zero counts and false flags remain observable', () => {
  const self = native(); self.native.peer.uid = 0; self.native.peer.pid = 0;
  const out = project(node({ chainId: 0, height: 0, validatorCount: 0, readyValidatorCount: 0, pendingTxCount: 0, catchingUp: false },
    { height: 0, transactions: [] }, [{ address: 'zero', moniker: 'zero', votingPower: '0', active: false }]), self);
  for (const key of ['chainId', 'height', 'validatorCount', 'readyValidatorCount', 'pendingTxCount']) assert.equal(out.status[key], '0', key);
  assert.equal(out.status.catchingUp, false); assert.equal(out.latestBlock.transactionCount, '0');
  assert.equal(out.validators.items[0].active, false); assert.equal(out.validators.votingPowerTotal, '0');
  assert.equal(out.native.peer.uid, '0'); assert.equal(out.native.peer.pid, '0');
});

test('JSON-rounded uint64 Numbers are unavailable, never reformatted as exact originals', () => {
  const unsafe = JSON.parse('{"height":18446744073709551615,"pendingTxCount":9007199254740993}');
  const out = project(node(unsafe, { height: '18446744073709551615' }, [{ address: 'a', votingPower: unsafe.pendingTxCount }]));
  assert.equal(out.status.height, null); assert.equal(out.status.pendingTxCount, null); assert.equal(out.latestBlock, null);
  assert.equal(out.validators.items[0].votingPower, null); assert.equal(out.validators.votingPowerTotal, null);
  assert.equal(out.validators.distribution, null); assert.equal(out.validators.distributionReason, 'INCOMPLETE_VOTING_POWER');
});

test('safe numeric boundary and original uint64 strings retain their exact decimal spelling', () => {
  const out = project(node({ height: '18446744073709551615', chainId: Number.MAX_SAFE_INTEGER }, { height: '18446744073709551615' }));
  assert.equal(out.status.height, '18446744073709551615'); assert.equal(out.latestBlock.height, '18446744073709551615');
  assert.equal(out.status.chainId, '9007199254740991');
  assert.equal(project(node({ height: '18446744073709551616' })).status.height, null);
});

test('bad integer encodings are not coerced, rounded or silently clamped', () => {
  const bad = [NaN, Infinity, -Infinity, -0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, true, [], {}, null,
    '', ' ', '00', '01', '+1', '-1', '1.0', '1e3', '0x10', '１２', '9'.repeat(10000)];
  for (const value of bad) {
    const out = project(node({ height: value, chainId: value, validatorCount: value }));
    assert.equal(out.status.height, null, String(value)); assert.equal(out.status.chainId, null);
    assert.equal(out.status.validatorCount, null);
  }
});

test('BigInt computes exact totals and bounded shares without unsafe intermediate Numbers', () => {
  const powers = ['9007199254740993', '9007199254740994', '0'];
  const out = project(node({}, {}, powers.map((votingPower, i) => ({ address: 'v' + i, votingPower }))));
  assert.equal(out.validators.votingPowerTotal, '18014398509481987');
  assert.deepEqual(out.validators.distribution.map(row => row.shareBps), [4999, 5000, 0]);
  assert.deepEqual(out.validators.items.map(row => row.votingPower), powers);
  const thirds = project(node({}, {}, [0, 1, 2].map(i => ({ address: 'v' + i, votingPower: '1' }))));
  assert.deepEqual(thirds.validators.distribution.map(row => row.shareBps), [3333, 3333, 3333]);
  assert.equal(thirds.validators.distribution.reduce((sum, row) => sum + row.shareBps, 0), 9999); // Do not fabricate remainder precision.
});

test('incomplete or duplicate validator membership never receives a partial total or chart', () => {
  for (const rows of [[{ address: 'a', votingPower: '1' }, { address: 'a', votingPower: '2' }],
    [{ address: 'a', votingPower: '1' }, { address: 'b' }], [{ votingPower: '1' }], [null],
    [{ address: 'a', votingPower: '-2' }], [{ address: 'a', votingPower: '9'.repeat(129) }]]) {
    const out = project(node({}, {}, rows));
    assert.equal(out.validators.votingPowerTotal, null); assert.equal(out.validators.distribution, null);
    assert.equal(out.validators.distributionReason, 'INCOMPLETE_VOTING_POWER');
  }
});

test('validator projection bounds its work and labels truncation instead of aggregating a subset', () => {
  const rows = Array.from({ length: 4097 }, (_, i) => ({ address: 'validator_' + i, votingPower: '1' }));
  const out = project(node({}, {}, rows));
  assert.equal(out.validators.count, '4097'); assert.equal(out.validators.items.length, 4096);
  assert.equal(out.validators.truncated, true); assert.equal(out.validators.votingPowerTotal, null);
  assert.equal(out.validators.distribution, null); assert.equal(out.validators.distributionReason, 'VALIDATOR_LIMIT');
});

test('a browser lacking BigInt preserves rows and exposes the unavailable aggregation', () => {
  const out = projector({ BigInt: undefined })(node({}, {}, [{ address: 'a', votingPower: '9007199254740993' }]));
  assert.equal(out.validators.items[0].votingPower, '9007199254740993');
  assert.equal(out.validators.votingPowerTotal, null); assert.equal(out.validators.distributionReason, 'BIGINT_UNAVAILABLE');
});

test('only current fixed-route RPC report data is usable; shape errors stay explicit', () => {
  const input = node(); input.reports.status = reported([]);
  input.reports.latestBlock = { status: 'unavailable', code: 'STATUS_HEIGHT_NOT_SUPPLIED', data: { height: 10 } };
  input.reports.validators = { status: 'unavailable', code: '<img onerror=alert(1)>' };
  const out = project(input);
  assert.equal(out.status, null); assert.equal(out.reports.status.code, 'INVALID_REPORT_DATA');
  assert.equal(out.latestBlock, null); assert.equal(out.reports.latestBlock.code, 'STATUS_HEIGHT_NOT_SUPPLIED');
  assert.equal(out.validators, null); assert.equal(out.reports.validators.code, 'REPORT_NOT_SUPPLIED');
});

test('a block unbound to the one observed status height is not shown as the latest block', () => {
  const out = project(node({ height: 12 }, { height: 13, hash: H }));
  assert.equal(out.status.height, '12'); assert.equal(out.latestBlock, null);
  assert.equal(out.reports.latestBlock.code, 'BLOCK_HEIGHT_NOT_BOUND');
});

test('untrusted markup, controls, bidi labels, invalid hashes and unsafe URLs are not display values', () => {
  const out = project({ ...node({ network: '<img src=x onerror=alert(1)>', latestBlockHash: 'javascript:alert(1)', latestBlockTime: 'not a time' }, {},
    [{ address: '<svg/onload=alert(1)>', moniker: 'name\u202eexe', votingPower: '1' }]), source: 'javascript:alert(1)' },
  native({ service: '<script>alert(1)</script>', nodeControl: 'running', resourceContribution: 'enabled' }));
  assert.equal(out.source, null); assert.equal(out.status.network, null); assert.equal(out.status.latestBlockHash, null);
  assert.equal(out.status.latestBlockTime, null); assert.equal(out.validators.items[0].address, null);
  assert.equal(out.validators.items[0].moniker, null); assert.equal(out.native.service, null);
  assert.equal(out.native.nodeControl, null); assert.equal(out.native.resourceContribution, null);
  for (const url of ['https://user:password@rpc.example', 'https://rpc.example/#secret', 'https://rpc.example/?token=secret', 'data:text/plain,rpc', 'file:///tmp/node']) {
    assert.equal(project({ ...node(), source: url }).source, null, url);
  }
});

test('valid ISO nanoseconds stay original and invalid calendar dates do not become recent activity', () => {
  for (const date of ['2026-02-30T10:00:00Z', '2025-02-29T10:00:00Z', '2026-13-01T10:00:00Z', '2026-10-31T24:01:00Z', '2026-10-31T10:00:00+25:00', '<time>']) {
    assert.equal(project(node({ latestBlockTime: date })).status.latestBlockTime, null, date);
  }
  assert.equal(project(node({ latestBlockTime: TIME })).status.latestBlockTime, TIME);
  assert.equal(project(node({ latestBlockTime: '2024-02-29T10:00:00Z' })).status.latestBlockTime, '2024-02-29T10:00:00Z');
});

test('RPC runtime claims and browser pairing cannot create native or financial authority', () => {
  const input = node({ height: 20, network: 'YNX Testnet', catchingUp: false,
    nodeIdentity: { configured: true, blockProductionEnabled: true, peerSyncTargetCount: 3 },
    peers: 64, staking: '99999999999999999999', avgBlockTime: '1s', balance: '999', synced: true });
  Object.assign(input, { native: native().native, paired: true, browserIdentityVerified: true, nativeGrant: true, authority: true, fundsVerified: true });
  const out = project(input, { paired: true, nativeGrant: true, walletApproval: true, browserIdentityVerified: false });
  assert.equal(out.native, null); assert.equal(out.authority, false);
  for (const key of ['peers', 'staking', 'avgBlockTime', 'balance', 'synced', 'managedNodes', 'walletApproval', 'nativeGrant']) {
    assert.equal(key in out, false, key); assert.equal(key in out.status, false, key);
  }
});

test('native self projection rejects browser identity claims and wrong native envelopes', () => {
  const cases = [null, {}, { native: null, browserIdentityVerified: false }];
  const browser = native(); browser.browserIdentityVerified = true; cases.push(browser);
  const peerBrowser = native(); peerBrowser.native.peer.browserIdentityVerified = true; cases.push(peerBrowser);
  const unverified = native(); unverified.native.peer.nativeIPCVerified = false; cases.push(unverified);
  const denied = native(); denied.native.code = 'DENIED'; cases.push(denied);
  const version = native(); version.native.version = 'fixture-v2'; cases.push(version);
  const missing = native(); delete missing.native.result.status; cases.push(missing);
  for (const item of cases) assert.equal(project(null, item).native, null);
});

test('self status does not import privileged payload, node lifecycle, meter or participation fields', () => {
  const self = native(); self.native.result.payload = { node: { stage: 'RUNNING', processOwned: true },
    meter: { verifiedJobs: 123, rewards: '100' }, entry: { state: 'CONFIRMED' }, walletApproval: true };
  Object.assign(self.native.result.status, { participation: 'approved', processOwned: true, rewards: '100' });
  const out = project(null, self).native;
  assert.equal(out.participation, null); assert.equal(out.nodeControl, 'unavailable');
  assert.equal(out.authority, false); assert.equal(out.browserIdentityVerified, false);
  assert.equal('meter' in out, false); assert.equal('processOwned' in out, false); assert.equal('rewards' in out, false);
  const unsafe = native(); unsafe.native.peer.uid = Number.MAX_SAFE_INTEGER + 1; unsafe.native.peer.pid = '2147483648';
  assert.equal(project(null, unsafe).native.peer.uid, null); assert.equal(project(null, unsafe).native.peer.pid, null);
});

test('projection neither mutates input nor retains mutable input objects or inherited claims', () => {
  const report = freeze(node({ height: 1, network: 'YNX Testnet' }, { height: 1, transactions: [] }, [{ address: 'v1', moniker: 'first', votingPower: '1' }]));
  const before = JSON.stringify(report); const out = project(report, freeze(native()));
  out.validators.items[0].moniker = 'changed'; out.status.network = 'changed';
  assert.equal(JSON.stringify(report), before); assert.equal(report.reports.validators.data.validators[0].moniker, 'first');
  assert.equal(project(Object.create({ classification: 'RPC_ONLY', reports: report.reports })).status, null);
  const primitive = { toString() { throw Error('must not coerce arbitrary objects'); } };
  assert.equal(project(node({ network: primitive, height: primitive })).status.height, null);
});

const ACTIVITY_VERSION = 'YNX-NETWORK-LOCAL-ACTIVITY/v1';
function localActivity() {
  return {
    version: ACTIVITY_VERSION, authority: false, productionGrant: false,
    node: { code: 'UNSUPPORTED', stage: 'not_installed', mode: 'production', processOwned: false,
      capacityComplete: true, usedBytes: '0', limitBytes: '67108864', freeBytes: '9007199254740993' },
    participation: { code: 'UNSUPPORTED', configured: true, walletPublisherConfigured: false,
      stopped: false, entries: '0', unknownEntries: '0' },
    resource: { code: 'DISABLED', state: 'disabled', activeWorkers: '0', verifiedJobs: '0',
      verifiedBytes: '0', rewards: 'NOT_AUTHORIZED', productionEnabled: false }
  };
}
function withActivity(activity = localActivity()) {
  const self = native();
  self.native.result.status.activity = activity;
  return self;
}

test('native local activity projects real default-disabled observations without granting authority', () => {
  const activity = localActivity();
  const out = project(null, withActivity(activity));
  assert.deepEqual(out.native.activity, activity);
  assert.equal(out.native.scope, 'helper-self-diagnostic');
  assert.equal(out.native.authority, false);
  assert.equal(out.native.browserIdentityVerified, false);
  assert.equal(out.native.activity.authority, false);
  assert.equal(out.native.activity.productionGrant, false);
  assert.equal(out.native.activity.node.processOwned, false);
  assert.equal(out.native.activity.node.usedBytes, '0');
  assert.equal(out.native.activity.node.freeBytes, '9007199254740993');
  assert.equal(out.native.activity.participation.walletPublisherConfigured, false);
  assert.equal(out.native.activity.resource.activeWorkers, '0');
  assert.equal(out.native.activity.resource.rewards, 'NOT_AUTHORIZED');
  assert.equal(out.native.activity.resource.productionEnabled, false);
  assert.equal(out.classification, 'RPC_ONLY');
  assert.equal(out.authority, false);
  assert.equal(out.native.participation, null); // Legacy field is not a Wallet grant.
});

test('native local activity preserves omitted unavailable measurements as null and legacy status still works', () => {
  const activity = {
    version: ACTIVITY_VERSION, authority: false, productionGrant: false,
    node: { code: 'NOT_SUPPLIED', processOwned: false, capacityComplete: false },
    participation: { code: 'UNAVAILABLE', configured: false, walletPublisherConfigured: false, stopped: false },
    resource: { code: 'UNAVAILABLE', rewards: 'NOT_AUTHORIZED', productionEnabled: false }
  };
  const out = project(null, withActivity(activity)).native;
  assert.deepEqual(out.activity.node, { code: 'NOT_SUPPLIED', stage: null, mode: null, processOwned: false,
    capacityComplete: false, usedBytes: null, limitBytes: null, freeBytes: null });
  assert.deepEqual(out.activity.participation, { code: 'UNAVAILABLE', configured: false,
    walletPublisherConfigured: false, stopped: false, entries: null, unknownEntries: null });
  assert.deepEqual(out.activity.resource, { code: 'UNAVAILABLE', state: null, activeWorkers: null,
    verifiedJobs: null, verifiedBytes: null, rewards: 'NOT_AUTHORIZED', productionEnabled: false });
  for (const missing of [null, false, [], 'activity', 0]) {
    const legacy = project(null, withActivity(missing)).native;
    assert.equal(legacy.activity, null);
    assert.equal(legacy.nodeControl, 'unavailable');
    assert.equal(legacy.resourceContribution, 'disabled');
  }
  const legacy = native();
  assert.equal(project(null, legacy).native.activity, null);
  assert.equal('activity' in legacy.native.result.status, false);
  const incomplete = localActivity();
  incomplete.node.capacityComplete = false;
  delete incomplete.node.usedBytes; delete incomplete.node.limitBytes; delete incomplete.node.freeBytes;
  const nodeOut = project(null, withActivity(incomplete)).native.activity.node;
  assert.equal(nodeOut.capacityComplete, false);
  assert.equal(nodeOut.usedBytes, null);
});

test('native local activity remains an observed sandbox or UNKNOWN state without rewards or production promotion', () => {
  const sandbox = localActivity();
  Object.assign(sandbox.node, { stage: 'running', mode: 'isolated-lifecycle-fixture', processOwned: true });
  Object.assign(sandbox.resource, { code: 'CONTROLLED_SANDBOX', state: 'running', activeWorkers: '1',
    verifiedJobs: '2', verifiedBytes: '18446744073709551615' });
  sandbox.participation.walletPublisherConfigured = true;
  sandbox.participation.code = 'CONFIGURED';
  const out = project(node({ height: 7 }), withActivity(sandbox));
  assert.equal(out.native.activity.node.processOwned, true);
  assert.equal(out.native.activity.node.mode, 'isolated-lifecycle-fixture');
  assert.equal(out.native.activity.resource.code, 'CONTROLLED_SANDBOX');
  assert.equal(out.native.activity.resource.verifiedBytes, '18446744073709551615');
  assert.equal(out.native.activity.participation.walletPublisherConfigured, true);
  assert.equal(out.native.activity.productionGrant, false);
  assert.equal(out.native.activity.authority, false);
  assert.equal(out.native.activity.resource.productionEnabled, false);
  assert.equal(out.native.activity.resource.rewards, 'NOT_AUTHORIZED');
  assert.equal(out.authority, false);
  for (const key of ['walletApproval', 'canStart', 'canVote', 'canStake', 'fundsVerified']) {
    assert.equal(key in out.native, false);
    assert.equal(key in out.native.activity, false);
  }
  Object.assign(sandbox.resource, { code: 'UNKNOWN', state: 'stopped', activeWorkers: '0' });
  Object.assign(sandbox.participation, { code: 'REVOKED', stopped: true, entries: '7', unknownEntries: '2' });
  const unknown = project(null, withActivity(sandbox)).native.activity;
  assert.equal(unknown.resource.code, 'UNKNOWN');
  assert.equal(unknown.resource.state, 'stopped');
  assert.equal(unknown.participation.code, 'REVOKED');
  assert.equal(unknown.participation.unknownEntries, '2');
  assert.equal(unknown.productionGrant, false);
});

test('native local activity rejects absent or escalated trust flags without discarding legacy diagnostic fields', () => {
  const edits = [
    value => { delete value.version; },
    value => { value.version = 'YNX-NETWORK-LOCAL-ACTIVITY/v2'; },
    value => { delete value.authority; },
    value => { value.authority = true; },
    value => { value.authority = 'false'; },
    value => { delete value.productionGrant; },
    value => { value.productionGrant = true; },
    value => { value.productionGrant = null; },
    value => { value.walletApproval = true; },
    value => { value.canStart = true; },
    value => { value.productionGrant = 0; },
    value => { value.Authority = false; }
  ];
  for (const edit of edits) {
    const activity = localActivity(); edit(activity);
    const out = project(null, withActivity(activity)).native;
    assert.equal(out.activity, null, edit.toString());
    assert.equal(out.nodeControl, 'unavailable');
    assert.equal(out.resourceContribution, 'disabled');
    assert.equal(out.authority, false);
  }
});

test('native local activity submodels fail independently for invalid codes, states and escalation fields', () => {
  const edits = [
    ['node', value => { value.code = 'RUNNING'; }],
    ['node', value => { value.processOwned = 'true'; }],
    ['node', value => { delete value.processOwned; }],
    ['node', value => { value.capacityComplete = 0; }],
    ['node', value => { value.productionGrant = true; }],
    ['participation', value => { value.code = 'APPROVED'; }],
    ['participation', value => { value.walletPublisherConfigured = 'true'; }],
    ['participation', value => { delete value.stopped; }],
    ['participation', value => { value.walletApproval = true; }],
    ['resource', value => { value.code = 'PRODUCTION'; }],
    ['resource', value => { value.state = 'enabled'; }],
    ['resource', value => { value.state = 'RUNNING'; }],
    ['resource', value => { value.state = { toString() { throw Error('never coerce'); } }; }],
    ['resource', value => { value.state = null; }],
    ['resource', value => { value.rewards = '100'; }],
    ['resource', value => { value.productionEnabled = true; }],
    ['resource', value => { delete value.productionEnabled; }],
    ['resource', value => { value.authority = false; }],
    ['resource', value => { value.state = 'running'; }],
    ['resource', value => { value.activeWorkers = '1'; }]
  ];
  for (const [bad, edit] of edits) {
    const activity = localActivity(); edit(activity[bad]);
    const out = project(null, withActivity(activity)).native.activity;
    assert.equal(out[bad], null, bad + ': ' + edit.toString());
    for (const sibling of ['node', 'participation', 'resource'].filter(key => key !== bad)) {
      assert.deepEqual(out[sibling], localActivity()[sibling], sibling + ' must remain independent');
    }
  }
  for (const bad of ['node', 'participation', 'resource']) {
    for (const value of [null, undefined, [], false, 'claimed']) {
      const activity = localActivity(); activity[bad] = value;
      const out = project(null, withActivity(activity)).native.activity;
      assert.equal(out[bad], null);
      assert.equal(out.authority, false);
    }
  }
});

test('native local activity never rounds or substitutes missing and malformed counters', () => {
  const bad = [undefined, null, true, false, {}, [], -0, -1, 0, 1, Number.MAX_SAFE_INTEGER,
    JSON.parse('9007199254740993'), NaN, Infinity, '', ' ', '00', '01', '+1', '-1', '1e3', '1.0',
    '１２', '18446744073709551616', '9'.repeat(10000), { toString() { throw Error('never coerce'); } }];
  for (const [section, keys] of [
    ['node', ['usedBytes', 'limitBytes', 'freeBytes']],
    ['participation', ['entries', 'unknownEntries']],
    ['resource', ['activeWorkers', 'verifiedJobs', 'verifiedBytes']]
  ]) {
    for (const key of keys) for (const value of bad) {
      const activity = localActivity(); activity[section][key] = value;
      const out = project(null, withActivity(activity)).native.activity;
      assert.equal(out[section][key], null, section + '.' + key + ': ' + typeof value);
      if (section === 'node') assert.equal(out.node.capacityComplete, null);
      assert.equal(out.authority, false);
      assert.equal(out.productionGrant, false);
    }
  }
  const activity = localActivity();
  for (const section of ['node', 'participation', 'resource']) {
    for (const key of Object.keys(activity[section]).filter(key => /Bytes$|Jobs$|Workers$|^[a-z]*Entries$|^entries$/.test(key))) activity[section][key] = '18446744073709551615';
  }
  // DISABLED with active workers contradicts its own state; use the actual sandbox classification.
  Object.assign(activity.resource, { code: 'CONTROLLED_SANDBOX', state: 'running' });
  const out = project(null, withActivity(activity)).native.activity;
  for (const section of ['node', 'participation', 'resource']) {
    for (const key of Object.keys(activity[section]).filter(key => /Bytes$|Jobs$|Workers$|^[a-z]*Entries$|^entries$/.test(key))) {
      assert.equal(out[section][key], '18446744073709551615');
    }
  }
});

test('native local activity is consumed only from gated helper status, never RPC or wrapper claims', () => {
  const rpc = node();
  rpc.activity = localActivity();
  rpc.native = withActivity().native;
  rpc.reports.status.data.activity = localActivity();
  const wrapper = { ...native(), activity: localActivity() };
  assert.equal(project(rpc, wrapper).native.activity, null);
  assert.equal('activity' in project(rpc, null), false);
  const payload = native(); payload.native.result.payload = { activity: localActivity() };
  assert.equal(project(rpc, payload).native.activity, null);
  const cases = [
    value => { value.browserIdentityVerified = true; },
    value => { delete value.browserIdentityVerified; },
    value => { value.native.peer.nativeIPCVerified = false; },
    value => { value.native.peer.browserIdentityVerified = true; },
    value => { value.native.version = 'YNX-NETWORK-LOCAL-IPC/v2'; },
    value => { value.native.code = 'UNAVAILABLE'; },
    value => { delete value.native.result.status; }
  ];
  for (const edit of cases) {
    const self = withActivity(); edit(self);
    assert.equal(project(rpc, self).native, null, edit.toString());
  }
});

test('native local activity rejects inherited claims and never retains mutable input references', () => {
  const inherited = Object.create(localActivity());
  assert.equal(project(null, withActivity(inherited)).native.activity, null);
  for (const section of ['node', 'participation', 'resource']) {
    const activity = localActivity();
    activity[section] = Object.create(activity[section]);
    assert.equal(project(null, withActivity(activity)).native.activity[section], null);
  }
  const malicious = localActivity();
  malicious.node.stage = '<img src=x onerror=alert(1)>';
  malicious.node.mode = 'mode\u202eexe';
  const sanitized = project(null, withActivity(malicious)).native.activity;
  assert.equal(sanitized.node.stage, null);
  assert.equal(sanitized.node.mode, null);
  const sandbox = { window: {}, URL };
  vm.runInNewContext(script, sandbox, { timeout: 1000 });
  const input = freeze(withActivity());
  const before = JSON.stringify(input);
  const out = sandbox.window.NetworkOverview.project(null, input);
  assert.notStrictEqual(out.native.activity, input.native.result.status.activity);
  for (const section of ['node', 'participation', 'resource']) {
    assert.notStrictEqual(out.native.activity[section], input.native.result.status.activity[section]);
  }
  out.native.activity.node.usedBytes = '123';
  out.native.activity.participation.entries = '123';
  out.native.activity.resource.verifiedJobs = '123';
  assert.equal(JSON.stringify(input), before);
  assert.equal(out.native.activity.authority, false);
  assert.equal(out.native.activity.productionGrant, false);
});

test('actual resource OS DTO and normal Source partial stay readable without a grant', () => {
  const activity = localActivity();
  Object.assign(activity.resource, {containmentMode:'os-worker-sampler', osMeasuredChildren:'0',osUserMicros:'18446744073709551615',osSystemMicros:'0',osPeakRSSBytes:'0',source:{code:'NOT_ADMITTED',nativeLinked:true,current:false,partialAcquired:true,cleanupPending:false,physicalComplete:true,firstCauseCode:'NETWORK_RESOURCE_NATIVE_66',productionEnabled:false}});
  const out = project(null,withActivity(activity));
  assert.equal(out.native.activity.resource.verifiedJobs,activity.resource.verifiedJobs);
  assert.equal(out.native.activity.resource.osUserMicros,'18446744073709551615');
  assert.equal(out.native.activity.resource.source.code,'NOT_ADMITTED');
  assert.equal(out.native.authority,false);
  assert.equal(out.native.activity.resource.productionEnabled,false);
});
test('Source metadata and OS counters reject authority, contradictions and lossy numbers', () => {
  const base={code:'NOT_ADMITTED',nativeLinked:true,current:false,partialAcquired:true,cleanupPending:false,physicalComplete:true,productionEnabled:false};
  for(const edit of [s=>s.authority=true,s=>s.productionEnabled=true,s=>s.current=true,s=>s.nativeLinked=false,s=>s.cleanupPending=true,s=>s.firstCauseCode='private path or key text',s=>s.code='APPROVED']) {
    const a=localActivity();a.resource.source={...base};edit(a.resource.source);
    assert.equal(project(null,withActivity(a)).native.activity.resource,null);
  }
  for(const value of [123,'01','18446744073709551616',null]) {
    const a=localActivity();a.resource.osUserMicros=value;
    assert.equal(project(null,withActivity(a)).native.activity.resource,null);
  }
});

function sampledNetwork({nullTransactions=false,brokenParent=false}={}) {
 const hash=h=>h.toString(16).padStart(64,'0');const value=node({height:10,latestBlockHash:hash(10)});
 const blocks=[10,9,8,7].map(h=>({status:'reported',data:{height:h,hash:hash(h),parentHash:hash(brokenParent&&h===9?1:h-1),time:`2026-11-01T12:00:${String(h*3).padStart(2,'0')}Z`,validator:'reported-validator',transactions:nullTransactions?null:[{hash:hash(100+h)}]}}));
 value.reports.latestBlock=blocks[0];value.reports.recentBlocks={status:'reported',data:{version:'YNX-NETWORK-RPC-BLOCK-WINDOW/v1',headHeight:'10',blocks}};value.receivedAt='2026-11-01T12:00:31Z';value.reports.status.latencyMicros='123456';return value;
}
test('real adjacent block sample derives interval and scoped TPS from explicit RPC arrays',()=>{
 const model=project(sampledNetwork());assert.equal(model.latestBlock.height,'10');assert.equal(model.recentBlocks.length,4);assert.equal(model.metrics.averageBlockSeconds,3);assert.equal(model.metrics.intervals,3);assert.equal(model.metrics.rpcSampleTPS,1/3);assert.equal(model.recentTransactions.length,4);assert.equal(model.receivedAt,'2026-11-01T12:00:31Z');assert.equal(model.statusLatencyMicros,'123456');assert.equal(model.authority,false);
});
test('null transaction lists and broken parent links never create fake zero TPS or timings',()=>{
 const missing=project(sampledNetwork({nullTransactions:true}));assert.equal(missing.metrics.averageBlockSeconds,3);assert.equal(missing.metrics.rpcSampleTPS,null);assert.equal(missing.transactionListsComplete,false);assert.deepEqual(missing.recentTransactions,[]);
 const broken=project(sampledNetwork({brokenParent:true}));assert.equal(broken.metrics.averageBlockSeconds,null);assert.equal(broken.metrics.rpcSampleTPS,null);
 const changed=sampledNetwork();changed.reports.latestBlock.data.hash='f'.repeat(64);assert.equal(project(changed).latestBlock,null);
});

function diagnosticsFixture(){return {code:'LOCAL_OBSERVATION_ONLY',authority:false,logs:{code:'INCOMPLETE',runId:'run-1',authority:false,stdout:{text:'<script>synced=true</script>\n',encoding:'utf-8-with-replacement',capturedBytes:'32',observedBytes:null,droppedBytes:null,truncated:null,wireTruncated:false,complete:false},stderr:null},synchronization:{code:'NOT_SUPPLIED',localHeight:null,targetHeight:null,catchingUp:null},recovery:{code:'RECONCILING',autoRestart:false,storedPIDIsControlHandle:false,processOwned:false,priorEffectUnknown:true}};}
test('owned node diagnostics preserve literal bounded logs and cannot create sync or control authority',()=>{
 const activity=localActivity();activity.node.diagnostics=diagnosticsFixture();let out=project(null,withActivity(activity)).native.activity.node.diagnostics;assert.equal(out.logs.stdout.text,'<script>synced=true</script>\n');assert.equal(out.logs.stdout.observedBytes,null);assert.equal(out.logs.stdout.truncated,null);assert.equal(out.synchronization.localHeight,null);assert.equal(out.authority,false);assert.equal(out.recovery.storedPIDIsControlHandle,false);
 for(const change of [d=>d.authority=true,d=>d.recovery.autoRestart=true,d=>d.recovery.storedPIDIsControlHandle=true,d=>d.synchronization.localHeight='99',d=>d.logs.stdout.text='x'.repeat(1537),d=>d.logs.stdout.observedBytes=0,d=>d.logs.permission=true]){const d=diagnosticsFixture();change(d);activity.node.diagnostics=d;assert.equal(project(null,withActivity(activity)).native.activity.node.diagnostics,null);}
});

// Read-only controlled lifecycle DTOs, not an original production runtime or
// proof of node role, networkId32, finality, permission, or real App acceptance.
const SYNC_NOW=Date.parse('2026-11-02T02:00:00Z');
const syncContext=()=>({mode:'isolated-lifecycle-fixture',stage:'running',processOwned:true,runId:'run-1',generation:'7'});
function syncSample(){return {code:'ISOLATED_PROCESS_REPORTED',localHeight:'9007199254740993',targetHeight:null,catchingUp:false,source:'owned-process-unix-comet',updatedAt:'2026-11-02T02:00:00.000000001Z',expiresAt:'2026-11-02T02:00:03.000000001Z',runId:'run-1',generation:'7',networkIdentity:{nativeChainId:'6423',nativeGenesisSHA256:'a'.repeat(64),cometChainId:'ynx-isolated-fixture',cometGenesisSHA256:'b'.repeat(64)},networkId32Observed:false,authority:false,isolatedFixture:true};}
function syncAPI(clock=()=>SYNC_NOW){const sandbox={window:{},URL,Date:class extends Date{static now(){return clock();}},fetch(){throw Error('synchronization projection must not fetch');}};vm.runInNewContext(script,sandbox);return sandbox.window.NetworkOverview;}
function missingSync(code='NOT_SUPPLIED'){return {code,localHeight:null,targetHeight:null,catchingUp:null,source:null,updatedAt:null,expiresAt:null,runId:null,generation:null,networkIdentity:null,networkId32Observed:false,authority:false,isolatedFixture:false};}
test('owned synchronization preserves only a bound isolated sample and exact int64 strings',()=>{
 const api=syncAPI(),sample=syncSample(),out=api.synchronization(sample,syncContext());
 assert.equal(out.code,'ISOLATED_PROCESS_REPORTED');assert.equal(out.localHeight,'9007199254740993');assert.equal(out.targetHeight,null);assert.equal(out.catchingUp,false);assert.equal(out.updatedAt,sample.updatedAt);assert.equal(out.expiresAt,sample.expiresAt);assert.equal(out.source,'owned-process-unix-comet');assert.equal(out.authority,false);assert.equal(out.networkId32Observed,false);assert.equal(out.isolatedFixture,true);assert.notStrictEqual(out.networkIdentity,sample.networkIdentity);
 out.networkIdentity.cometChainId='changed-output';assert.equal(sample.networkIdentity.cometChainId,'ynx-isolated-fixture');sample.localHeight='3';assert.equal(out.localHeight,'9007199254740993');
 const activity=localActivity();Object.assign(activity.node,syncContext());delete activity.node.runId;delete activity.node.generation;activity.node.diagnostics=diagnosticsFixture();activity.node.diagnostics.synchronization=syncSample();const projected=api.project(null,withActivity(activity));assert.equal(projected.native.activity.node.diagnostics.synchronization.localHeight,'9007199254740993');assert.equal(projected.native.authority,false);
});
test('owned synchronization clears every sample field for expiry and all unavailable states',()=>{
 const api=syncAPI(),emptyKeys=['localHeight','targetHeight','catchingUp','source','updatedAt','expiresAt','runId','generation','networkIdentity'];
 for(const code of ['NOT_SUPPLIED','NOT_RUNNING','EXPIRED','UNAVAILABLE']){const out=api.synchronization(missingSync(code),syncContext());assert.equal(out.code,code);for(const key of emptyKeys)assert.equal(out[key],null,key);assert.equal(out.isolatedFixture,false);}
 const expired=syncAPI(()=>SYNC_NOW+3001).synchronization(syncSample(),syncContext());assert.equal(expired.code,'EXPIRED');for(const key of emptyKeys)assert.equal(expired[key],null,key);
 const legacy=api.synchronization({code:'NOT_SUPPLIED',localHeight:null,targetHeight:null,catchingUp:null});assert.equal(legacy.code,'NOT_SUPPLIED');assert.equal(legacy.authority,false);
});
test('owned synchronization rejects forged authority, production bindings, targets and malformed material',()=>{
 const api=syncAPI();for(const edit of [
  s=>s.authority=true,s=>delete s.authority,s=>s.networkId32Observed=true,s=>s.isolatedFixture=false,
  s=>s.localHeight=9007199254740993,s=>s.localHeight='0',s=>s.localHeight='01',s=>s.localHeight='9223372036854775808',s=>s.targetHeight='9007199254740994',s=>s.catchingUp=0,
  s=>s.source='https://rpc.ynxweb4.com',s=>s.runId='foreign-run',s=>s.generation='8',s=>s.generation=7,
  s=>s.updatedAt='2026-11-02T02:00:02Z',s=>s.expiresAt='2026-11-02T02:00:04Z',s=>s.updatedAt='2026-02-30T02:00:00Z',s=>s.expiresAt='2026-11-02T02:00:03+00:00',
  s=>s.networkIdentity.networkId32='a'.repeat(64),s=>s.networkIdentity.nativeChainId=6423,s=>s.networkIdentity.nativeGenesisSHA256='A'.repeat(64),s=>s.networkIdentity.cometChainId='<script>',s=>s.approved=true
 ]){const sample=syncSample();edit(sample);assert.equal(api.synchronization(sample,syncContext()),null,edit.toString());}
 for(const edit of [c=>c.mode='production',c=>c.stage='stopped',c=>c.processOwned=false,c=>c.runId='other',c=>c.generation='8']){const context=syncContext();edit(context);assert.equal(api.synchronization(syncSample(),context),null,edit.toString());}
 for(const sample of [null,{},Object.create(syncSample()),{...missingSync('EXPIRED'),localHeight:'9'},{...missingSync(),approved:true}])assert.equal(api.synchronization(sample,syncContext()),null);
});
test('owned synchronization is never projected from RPC, wrapper claims or an ungated helper',()=>{
 const api=syncAPI(),a=localActivity();Object.assign(a.node,{mode:'isolated-lifecycle-fixture',stage:'running',processOwned:true});a.node.diagnostics=diagnosticsFixture();a.node.diagnostics.synchronization=syncSample();const input=withActivity(a);
 const rpc=node({synchronization:syncSample()});rpc.synchronization=syncSample();assert.equal(api.project(rpc,null).native,null);
 for(const edit of [n=>n.browserIdentityVerified=true,n=>n.native.peer.nativeIPCVerified=false,n=>n.native.peer.browserIdentityVerified=true,n=>n.native.result={payload:{activity:a}}]){const v=structuredClone(input);edit(v);assert.equal(api.project(null,v).native,null);}
 const out=api.project(null,freeze(input));assert.equal(out.native.activity.node.diagnostics.synchronization.networkId32Observed,false);
});
