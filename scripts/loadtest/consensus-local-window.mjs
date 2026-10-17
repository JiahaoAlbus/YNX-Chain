// A single scheduled, bounded local window. No build, existing data reuse,
// external endpoint, public deployment or sustained load is performed here.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const { values } = parseArgs({ options: {
  execute: { type: 'boolean', default: false },
  'bin-dir': { type: 'string' }, 'comet-bin': { type: 'string' },
  'work-parent': { type: 'string', default: 'artifacts/chain-network-performance' },
  count: { type: 'string', default: '32' },
  rounds: { type: 'string', default: '1' },
  'sender-mode': { type: 'string', default: 'rounds' },
	'state-layout': {type:'string',default:'atomic-json'},
  'offered-rate': { type: 'string', default: '0' },
} });
const stateLayout=values['state-layout'];
if(!['atomic-json','snapshot-journal','block-journal'].includes(stateLayout))throw Error('unsupported state-layout');
const count = Number(values.count);
if (process.platform !== 'darwin') throw Error('this launcher requires the macOS proc_pidtaskinfo resource probe');
// Match consensus.EphemeralWorkloadMaxTransactions; resource caps do not grow.
if (!Number.isInteger(count) || count < 1 || count > 2048) throw Error('count must be 1..2048');
const rounds = Number(values.rounds);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 32 || count * rounds > 2048) throw Error('rounds must be 1..32 and total count at most 2048');
const offeredRate = Number(values['offered-rate']);
const senderMode=values['sender-mode'];
if(!['rounds','ready-pool'].includes(senderMode))throw Error('unsupported sender-mode');
if(senderMode==='ready-pool'&&(rounds<2||offeredRate<=0))throw Error('ready-pool requires at least two nonce cycles and positive offered-rate');
if (!Number.isFinite(offeredRate) || offeredRate < 0 || offeredRate > 2048) throw Error('offered-rate must be in 0..2048');
if (offeredRate > 0 && rounds * (count - 1) / offeredRate >= 10) throw Error('offering span does not fit the full 10-second client deadline');
if(senderMode==='ready-pool'&&(count*rounds-1)/offeredRate>=10)throw Error('ready-pool offering span does not fit client deadline');
if (!values['bin-dir'] || !values['comet-bin']) throw Error('prebuilt --bin-dir and --comet-bin are required');
const bin = path.resolve(values['bin-dir']);
const commands = {
  fixture: path.join(bin, 'ynx-consensus-perf-fixture'),
  app: path.join(bin, 'ynx-abci'),
  client: path.join(bin, 'ynx-consensus-perf-client'),
  comet: path.resolve(values['comet-bin']),
  host: path.join(bin, 'ynx-consensus-perf-host'),
};
for (const command of Object.values(commands)) fs.accessSync(command, fs.constants.X_OK);
const caps = { activeMs: 45000, cleanupMs: 15000, dataBytes: 32 * 1024 * 1024, rssBytes: 1024 ** 3, freeDiskFloorBytes: 1024 ** 3, rootDiskReserveBytes: 425 * 1024 ** 2, longLivedChildren: 9, threadsWithControlReserve: 320, fullHostSampleMs: 1000, logBytesPerProcess: 1024 * 1024, clientTimeout: '10s', clientConcurrency: 4, clientObservers: 4, gomaxprocs: 1 };
if (!values.execute) {
  console.log(JSON.stringify({ status: 'prepared_only_no_processes_started', commands, count, rounds, senderMode, stateLayout, totalTransactions: count * rounds, offeredRate, caps, ports: { p2p: 31656, rpc: 31757, abci: 31858 } }, null, 2));
  process.exit(0);
}

const parent = path.resolve(values['work-parent']);
// Check the nearest existing ancestor before creating any directory.
let diskAncestor = parent;
while (!fs.existsSync(diskAncestor)) diskAncestor = path.dirname(diskAncestor);
function freeDiskBytes() {
  const info = fs.statfsSync(diskAncestor);
  return Number(info.bavail) * Number(info.bsize);
}
if (freeDiskBytes() < caps.freeDiskFloorBytes + caps.rootDiskReserveBytes + caps.dataBytes) throw Error('fresh free disk below floor plus Root reserve and maximum data delta');
fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
const work = fs.mkdtempSync(path.join(parent, 'window-'));
const network = path.join(work, 'network');
const children = [];
const started = Date.now();
let firstCause = null;
let stopping = false;
let peakRSSBytes = 0;
let peakDataBytes = 0;
let peakThreadsWithControlReserve = 0;
let peakLongLivedChildren = 0;
let lastFullHostSample = 0;
const hostSamples = [];
const probeFailures = [];
let lastResourceSample;
let monitor;
const fail = reason => { if (!firstCause) firstCause = String(reason); };
const deadline = setTimeout(() => fail('active window exceeded 45 seconds'), caps.activeMs);
const onSignal = signal => fail(`launcher received ${signal}`);
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

function requireActive() {
  if (firstCause) throw Error(firstCause);
  if (freeDiskBytes() < caps.freeDiskFloorBytes) throw Error('free disk below configured floor');
  if (Date.now() - started >= caps.activeMs) throw Error('active deadline reached');
}

function directoryBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const item = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directoryBytes(item);
    else if (entry.isFile()) {
      // Atomic snapshot replacement can remove a temp file between readdir
      // and stat. The next sample covers its renamed destination.
      try { const stat = fs.statSync(item); total += Math.max(stat.size, stat.blocks * 512); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    else throw Error('unexpected non-regular local test artifact');
  }
  return total;
}

function launch(name, command, args, persistent = false) {
  requireActive();
  if (children.filter(c => !c.exited).length >= caps.longLivedChildren) throw Error('long-lived owned child process cap reached');
  const out = fs.openSync(path.join(work, `${name}.log`), 'wx', 0o600);
  const child = spawn('nice', ['-n', '10', command, ...args], {
    detached: true, env: { ...process.env, GOMAXPROCS: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = { name, pid: child.pid, child, bytes: 0, exitCode: null, signal: null, exited: false, persistent };
  children.push(record);
  const capture = data => {
    const remaining = caps.logBytesPerProcess - record.bytes;
    if (remaining > 0) { const chunk = data.subarray(0, remaining); fs.writeSync(out, chunk); record.bytes += chunk.length; }
    if (data.length > remaining) fail(`${name} exceeded 1 MiB log limit`);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  record.closed = new Promise(resolve => {
    child.on('error', error => fail(`${name} spawn: ${error.message}`));
    child.on('close', (code, signal) => {
      record.exitCode = code; record.signal = signal; record.exited = true;
      fs.closeSync(out);
      if (!stopping && (persistent || code !== 0)) fail(`${name} exited early: code=${code} signal=${signal}`);
      resolve();
    });
  });
  return record;
}

async function waitExit(record) {
  while (!record.exited) { requireActive(); await delay(50); }
  requireActive();
  if (record.exitCode !== 0) throw Error(`${record.name} failed with ${record.exitCode}`);
}

async function portFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

function signalGroup(record, signal) {
  if (!record.pid) return;
  try { process.kill(-record.pid, signal); } catch (error) { if (error.code !== 'ESRCH') fail(`${record.name} cleanup: ${error.message}`); }
}

function sampleResources(full) {
  const live = children.filter(c => c.pid && !c.exited);
  peakLongLivedChildren = Math.max(peakLongLivedChildren, live.length);
  const watched = [...new Set([process.pid, process.ppid, ...live.map(c => c.pid)])];
  const result = spawnSync(commands.host, [...(full ? ['--full'] : []), ...watched.map(String)], { encoding: 'utf8', timeout: 1500, maxBuffer: 1024 * 1024 });
  if (result.error || result.signal || result.status !== 0) {
    probeFailures.push({ sampledAt: new Date().toISOString(), error: result.error?.message, status: result.status, signal: result.signal, stdout: result.stdout?.slice(0,65536), stderr: result.stderr?.slice(0,65536) });
    throw Error(`native resource probe failed: ${result.error ?? result.signal ?? result.status}`);
  }
  let sample;
  try { sample = JSON.parse(result.stdout); }
  catch (error) {
    probeFailures.push({ sampledAt: new Date().toISOString(), error: error.message, stdout: result.stdout.slice(0,65536), stderr: result.stderr.slice(0,65536) });
    throw Error('native resource probe returned invalid JSON; raw failure retained');
  }
  if (!Number.isFinite(sample.rssWithControlReserveBytes) || !Number.isInteger(sample.threadsWithControlReserve)) throw Error('invalid kernel resource sample');
  if (!sample.processes.some(p => p.pid === process.pid && p.readable)) throw Error('launcher task info unavailable');
  lastResourceSample = sample;
  if (full) hostSamples.push({ sampledAt: new Date().toISOString(), ...sample });
  peakRSSBytes = Math.max(peakRSSBytes, sample.rssWithControlReserveBytes);
  peakThreadsWithControlReserve = Math.max(peakThreadsWithControlReserve, sample.threadsWithControlReserve);
  if (sample.rssWithControlReserveBytes > caps.rssBytes) throw Error(`owned/control RSS with sampler reserve exceeded ${caps.rssBytes} bytes`);
  if (sample.threadsWithControlReserve > caps.threadsWithControlReserve) throw Error('owned/control kernel thread count with reserve exceeded 320');
  if (full && !sample.forkProbe?.available) throw Error(`ordinary fork probe unavailable: ${JSON.stringify(sample.forkProbe)}`);
}

try {
  for (const base of [31656, 31757, 31858]) for (let offset = 0; offset < 4; offset++) await portFree(base + offset);
  sampleResources(true);
  lastFullHostSample = Date.now();
  monitor = setInterval(() => {
    try {
      const full = Date.now() - lastFullHostSample >= caps.fullHostSampleMs;
      if (full) lastFullHostSample = Date.now();
      sampleResources(full);
      const size = directoryBytes(work);
      peakDataBytes = Math.max(peakDataBytes, size);
      if (size > caps.dataBytes) fail(`local output/data exceeded ${caps.dataBytes} bytes`);
    } catch (error) { fail(error.message); }
  }, 250);
  await waitExit(launch('fixture', commands.fixture, ['-ephemeral', '-output', network, '-count', String(count), ...(rounds > 1 ? ['-retain-ephemeral-senders'] : [])]));
  const manifestPath = path.join(network, 'network-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.nodes.length !== 4 || !manifest.purpose.includes('local-ephemeral')) throw Error('not a local four-validator fixture');
  for (const node of manifest.nodes) {
    if (!node.home.startsWith(network + path.sep) || !node.abciStatePath.startsWith(network + path.sep) || !/^tcp:\/\/127\.0\.0\.1:\d+$/.test(node.abciListen) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(node.rpcUrl)) throw Error('fixture escaped local scope');
  }
  for (const [index, node] of manifest.nodes.entries()) launch(`abci-${index}`, commands.app, ['-listen', node.abciListen, '-migration-state', manifest.migrationPath, '-state', node.abciStatePath, ...(stateLayout!=='atomic-json'?['-state-layout',stateLayout]:[])], true);
  await delay(300);
  for (const [index, node] of manifest.nodes.entries()) launch(`comet-${index}`, commands.comet, ['start', '--home', node.home], true);
  for (const node of manifest.nodes) {
    while (true) {
      requireActive();
      try {
        const response = await fetch(`${node.rpcUrl}/status`, { signal: AbortSignal.timeout(1000), redirect: 'error' });
        const status = await response.json();
        if (response.ok && Number(status.result?.sync_info?.latest_block_height) >= 2) break;
      } catch { /* bounded startup retry; the active deadline remains authoritative */ }
      await delay(100);
    }
  }
  await waitExit(launch('client', commands.client, ['-manifest', manifestPath, '-transactions', path.join(network, 'transactions.json'), '-output', path.join(work, 'transactions-result.json'), '-timeout', caps.clientTimeout, '-concurrency', String(caps.clientConcurrency), '-observers', String(caps.clientObservers), '-offered-rate', String(offeredRate), '-rounds', String(rounds), ...(senderMode==='ready-pool'?['-sender-mode',senderMode]:[])]));
} catch (error) {
  fail(error.message);
} finally {
  stopping = true;
  clearTimeout(deadline);
  clearInterval(monitor);
  const stopStarted = Date.now();
  for (const child of children.filter(c => !c.exited)) signalGroup(child, 'SIGINT');
  while (children.some(c => !c.exited) && Date.now() - stopStarted < 12000) await delay(100);
  for (const child of children.filter(c => !c.exited)) signalGroup(child, 'SIGKILL');
  await Promise.race([Promise.all(children.map(c => c.closed)), delay(Math.max(1, caps.cleanupMs - (Date.now() - stopStarted)), undefined, { ref: false })]);
  const finalDataBytes = directoryBytes(work);
  peakDataBytes = Math.max(peakDataBytes, finalDataBytes);
  if (finalDataBytes > caps.dataBytes) fail(`final local output/data exceeded ${caps.dataBytes} bytes`);
  const processReceipt = children.map(({ name, pid, exitCode, signal, exited }) => {
    let groupGone = false;
    if (pid) { try { process.kill(-pid, 0); } catch (error) { groupGone = error.code === 'ESRCH'; } }
    else groupGone = exited;
    if (!exited || !groupGone) fail(`${name} process/group did not fully exit`);
    return { name, pid, exitCode, signal, exited, groupGone };
  });
  const receipt = { schema: 3, startedAt: new Date(started).toISOString(), work, caps, count, rounds, senderMode, stateLayout, totalTransactions: count * rounds, offeredRate, elapsedMs: Date.now() - started, cleanupMs: Date.now() - stopStarted, firstCause, peakRSSBytes, rssScope: 'kernel task info: launcher, parent, live children plus sampler and conservative fork-child reserve', peakDataBytes, peakThreadsWithControlReserve, peakLongLivedChildren, hostSamples, probeFailures, lastResourceSample, processes: processReceipt, allGroupsGone: processReceipt.every(c => c.exited && c.groupGone), resultPath: path.join(work, 'transactions-result.json') };
  fs.writeFileSync(path.join(work, 'window-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
  process.exitCode = firstCause ? 1 : 0;
}
