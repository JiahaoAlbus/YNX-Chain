import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const execute = promisify(execFile);

export function parseProcessTable(text) {
  return text.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), executable: match[3] }] : [];
  });
}

export function deriveOwnedScope(table, rootPID, expectedExecutable, roles = {}) {
  const root = table.find(row => row.pid === rootPID);
  if (!root || root.executable !== expectedExecutable) throw new Error('Root PID/executable identity does not match the dedicated test launch');
  const owned = new Set([rootPID]); let changed = true;
  while (changed) { changed = false; for (const row of table) if (owned.has(row.ppid) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; } }
  return table.filter(row => owned.has(row.pid)).map(row => ({ ...row, role: roles[row.pid] ?? (row.pid === rootPID ? 'test-root' : 'unclassified-owned-child'), attribution: row.pid === rootPID ? 'exact-root-executable' : 'OS-parent-chain' }));
}

export function identifyWebKitRoles(scope, rootPID) {
  // Parent-chain evidence only. Never attribute a launchd-owned process by its WebKit name alone.
  const identified = scope.map(process => {
    let role = process.pid === rootPID ? 'browser-ui' : 'unclassified-owned-child';
    if (process.pid !== rootPID && /^\/System\/(?:Volumes\/Preboot\/Cryptexes\/App\/System\/)?Library\/Frameworks\/WebKit\.framework\//.test(process.executable)) {
      if (process.executable.endsWith('/com.apple.WebKit.Networking')) role = 'webkit-network';
      if (process.executable.endsWith('/com.apple.WebKit.WebContent')) role = 'webkit-webcontent';
    }
    return { ...process, role };
  });
  return { processes: identified, attributedRoles: [...new Set(identified.map(process => process.role))], missing: ['webkit-network', 'webkit-webcontent'].filter(role => !identified.some(process => process.role === role)), xpcResponsibilityVerified: false };
}

function parseEndpoint(value) {
  const match = value.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d+|\*)$/);
  return match ? { host: match[1] ?? match[2], port: match[3] === '*' ? null : Number(match[3]) } : null;
}

export function parseLsofFields(text, scope) {
  const allowed = new Map(scope.map(process => [process.pid, process]));
  const sockets = []; let pid, current;
  for (const raw of text.split('\0')) {
    const field = raw.replace(/^\n+|\n+$/g, ''); if (!field) continue;
    const kind = field[0], value = field.slice(1);
    if (kind === 'p') { pid = Number(value); if (!allowed.has(pid)) throw new Error('lsof returned a process outside the preselected test scope'); }
    if (kind === 'f') { current = { pid, role: allowed.get(pid)?.role, descriptor: value }; sockets.push(current); }
    if (!current) continue;
    if (kind === 'P') current.protocol = value.toLowerCase();
    if (kind === 'T' && value.startsWith('ST=')) current.state = value.slice(3);
    if (kind === 'n') { const [local, remote] = value.split('->'); current.local = parseEndpoint(local); current.remote = remote ? parseEndpoint(remote) : null; current.endpointParsed = !!current.local && (!remote || !!current.remote); }
  }
  return sockets;
}

export async function rawCapturePermissionProbe() {
  // Permission-only open; zero bytes are read and no packet capture is started.
  try { const device = await open('/dev/bpf0', 'r'); await device.close(); return { device: '/dev/bpf0', opened: true, bytesRead: 0, rawCaptureStarted: false, status: 'ACCESSIBLE_NOT_CAPTURED' }; }
  catch (error) { return { device: '/dev/bpf0', opened: false, bytesRead: 0, rawCaptureStarted: false, status: 'UNAVAILABLE', code: error.code, syscall: error.syscall }; }
}

export function classifyScopedSockets(sockets, routeEndpoints, syntheticTargets) {
  const key = (endpoint, transport = endpoint?.transport ?? 'tcp') => endpoint && `${transport}:${endpoint.host}:${endpoint.port}`;
  const routeKeys = new Set(routeEndpoints.map(endpoint => key(endpoint))), targetKeys = new Set(syntheticTargets.map(endpoint => key(endpoint)));
  return sockets.map(socket => {
    const destinationClass = !socket.remote ? 'listener-or-unconnected' : routeKeys.has(key(socket.remote, socket.protocol)) ? 'route-entry' : targetKeys.has(key(socket.remote, socket.protocol)) ? 'synthetic-target' : 'outside-synthetic-allowlist';
    return { ...socket, remote: destinationClass === 'outside-synthetic-allowlist' ? { redacted: true } : socket.remote, destinationClass };
  });
}

export async function collectOwnedSnapshot({ rootPID, expectedExecutable, roles = {}, routeEndpoints = [], syntheticTargets = [] }) {
  if (process.platform !== 'darwin' || !Number.isInteger(rootPID) || rootPID <= 1) throw new Error('A dedicated, owned macOS test root PID is required');
  const table = parseProcessTable((await execute('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { maxBuffer: 8 * 1024 * 1024 })).stdout);
  const scope = deriveOwnedScope(table, rootPID, expectedExecutable, roles);
  const pids = scope.map(row => row.pid).join(',');
  let output = '', lsofExit = 0, lsofError = '';
  try { output = (await execute('/usr/sbin/lsof', ['-nP', '-a', '-p', pids, '-i', '-F0pfPnT'], { maxBuffer: 4 * 1024 * 1024 })).stdout; }
  catch (error) { lsofExit = error.code; output = error.stdout ?? ''; lsofError = (error.stderr ?? '').slice(0, 1024); }
  const sockets = parseLsofFields(output, scope);
  const classified = classifyScopedSockets(sockets, routeEndpoints, syntheticTargets);
  return {
    schema: 'YNX_OWNED_SOCKET_SNAPSHOT_V1', observedAt: Date.now(), collector: '/usr/sbin/lsof -nP -a -p <preselected-owned-PIDs> -i -F0pfPnT',
    scope, sockets: classified, lsofExit, lsofError, outputSHA256: createHash('sha256').update(output).digest('hex'),
    scopeLimitations: ['FD snapshots can miss short-lived sends', 'No DNS/UDP payload capture', 'Parentage does not attribute launchd-owned WebKit XPC auxiliaries', 'No claim of packet non-emission'],
    rawCaptureAvailable: false, targetVerdict: 'INCOMPLETE', opensRouteMode: false
  };
}

export async function observeDedicatedClient({ rootPID, executable, expectedSHA256, runID, routeEndpoints, syntheticTargets, samples = 3 }) {
  if (!/^[a-z0-9-]{1,40}$/.test(runID) || !Number.isInteger(samples) || samples < 1 || samples > 20) throw new Error('Bounded synthetic run ID/sample count required');
  await inspectExactClientBinary(executable, expectedSHA256);
  // Inspect only the exact selected root's arguments; they are never retained or emitted.
  const args = (await execute('/bin/ps', ['-p', String(rootPID), '-o', 'args='], { maxBuffer: 64 * 1024 })).stdout;
  if (!args.split(/\s+/).includes(`--p05-synthetic-run=${runID}`)) throw new Error('Dedicated synthetic-only product startup marker is absent; network observation refused');
  const observations = [];
  for (let index = 0; index < samples; index++) {
    observations.push(await collectOwnedSnapshot({ rootPID, expectedExecutable: executable, routeEndpoints, syntheticTargets }));
    if (index + 1 < samples) await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { schema: 'YNX_DEDICATED_CLIENT_OBSERVATION_V1', runID, binarySHA256: expectedSHA256, identity: identifyWebKitRoles(observations[0].scope, rootPID), observations, rawCapture: await rawCapturePermissionProbe(), targetVerdict: 'INCOMPLETE', opensRouteMode: false, limits: ['A startup marker is not proof that product source enforces synthetic-only behavior', 'Requires the exact reviewed product launch contract', 'No WebKit XPC responsibility decoder or packet capture supplied'] };
}

export async function inspectExactClientBinary(filename, expectedSHA256) {
  if (!filename.startsWith('/') || !/^[a-f0-9]{64}$/.test(expectedSHA256)) throw new Error('Exact absolute client executable and SHA-256 are required');
  const actualSHA256 = createHash('sha256').update(await readFile(filename)).digest('hex');
  if (actualSHA256 !== expectedSHA256) throw new Error('Client executable hash mismatch');
  return { executable: filename, actualSHA256, launched: false, targetVerdict: 'INCOMPLETE', missing: ['PRODUCT_SYNTHETIC_ONLY_LAUNCH_CONTRACT', 'TRUSTED_UI_TO_WEBKIT_XPC_PROCESS_ATTRIBUTION', 'INDEPENDENT_CLIENT_PACKET_CAPTURE'], opensRouteMode: false };
}
