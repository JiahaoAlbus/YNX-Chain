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
  assert.deepEqual(Object.keys(out), ['classification', 'authority', 'source', 'reports', 'status', 'latestBlock', 'validators', 'native']);
  assert.equal('sources' in out, false); assert.equal('sourceCount' in out, false); assert.equal('recentBlocks' in out, false);
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
