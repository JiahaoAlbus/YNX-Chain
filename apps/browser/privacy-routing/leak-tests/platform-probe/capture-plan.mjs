import { createHash } from 'node:crypto';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export function buildOwnedListenerCapturePlan({ runID, listeners, durationSeconds = 20 }) {
  if (!/^[a-z0-9-]{1,40}$/.test(runID) || !Array.isArray(listeners) || !listeners.length || listeners.length > 16 || !Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 30) throw new Error('One bounded run, 1...16 owned listeners and 1...30 second duration required');
  for (const listener of listeners) {
    if (!['127.0.0.1', '::1'].includes(listener.host) || !['tcp', 'udp'].includes(listener.transport) || !Number.isInteger(listener.port) || listener.port < 1024 || listener.port > 65535 || !Number.isInteger(listener.pid) || listener.pid <= 1) throw new Error('Only exact owned non-privileged loopback listener tuples are permitted');
  }
  const filter = listeners.map(value => `(${value.transport} and host ${value.host} and port ${value.port})`).join(' or ');
  const arguments_ = ['-i', 'lo0', '-p', '-n', '-s', '256', '-U', '-w', '-', '(' + filter + ')'];
  return { schema: 'P05_REVIEWABLE_OWNED_CAPTURE_PLAN_V1', runID, listeners, durationSeconds, executable: '/usr/sbin/tcpdump', arguments: arguments_, datalinkPolicy: 'Plain lo0; kernel BPF installed by tcpdump before reads; NO pktap/PCAPNG or -Q userspace PID filter', scope: 'Only these owned loopback TCP/UDP tuples, never all DNS or all WebKit traffic', requiresAdministrator: true, automaticallyElevates: false, executesDuringPreparation: false, targetVerdict: 'INCOMPLETE', gaps: ['No non-loopback egress coverage', 'No system/shared resolver DNS coverage', 'No proof of complete WebKit XPC ownership', 'NetworkExtension exact audit-token gating is a separate entitlement/user-activation gate'] };
}

export async function prepareOwnedListenerCapture(configuration, directory) {
  const plan = buildOwnedListenerCapturePlan(configuration);
  plan.reviewedUID = process.getuid();
  plan.processIncarnations = [];
  for (const pid of [...new Set(plan.listeners.map(listener => listener.pid))]) {
    const snapshot = (await execute('/bin/ps', ['-p', String(pid), '-o', 'uid=', '-o', 'lstart='], { maxBuffer: 4096 })).stdout.trim();
    if (!snapshot || Number(snapshot.split(/\s+/)[0]) !== plan.reviewedUID) throw new Error('Only current-user owned live listener processes may enter a capture plan');
    plan.processIncarnations.push({ pid, uidAndStart: snapshot });
  }
  const bytes = Buffer.from(JSON.stringify(plan, null, 2) + '\n'), sha256 = createHash('sha256').update(bytes).digest('hex');
  await mkdir(directory, { mode: 0o700 });
  directory = await realpath(directory);
  await writeFile(join(directory, 'capture-plan.json'), bytes, { mode: 0o600, flag: 'wx' });
  // Self-contained executor: no mutable local imports, shell commands, automatic sudo or broad
  // capture. ChildProcess handles prevent signaling a recycled numeric PID; early/nonzero exits
  // remain failures. Exclusive no-follow file descriptors prevent root overwriting user paths.
  const script = `import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, lstat, realpath, readFile, writeFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = ${JSON.stringify(sha256)}, directory = ${JSON.stringify(resolve(directory))};
const execute = promisify(execFile);
if (process.argv.length !== 4 || process.argv[2] !== '--execute-reviewed-plan' || process.argv[3] !== expected) { console.error('Review this executor and capture-plan.json. Exact administrator invocation is required; no automatic elevation.'); process.exit(64); }
if (process.getuid() !== 0) { console.error('Administrator permission required for this exact owned-listener capture. No capture attempted.'); process.exit(77); }
process.umask(0o077);
const metadata = await lstat(directory);
if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o022) || await realpath(directory) !== directory) throw Error('Unsafe capture directory');
process.chdir(directory);
const input = await open('capture-plan.json', constants.O_RDONLY | constants.O_NOFOLLOW);
const bytes = await input.readFile(); await input.close();
if (digest(bytes) !== expected) throw Error('Capture plan changed; refusing');
const plan = JSON.parse(bytes);
if (metadata.uid !== plan.reviewedUID) throw Error('Capture directory owner changed');
for (const process_ of plan.processIncarnations) {
  const snapshot = (await execute('/bin/ps', ['-p', String(process_.pid), '-o', 'uid=', '-o', 'lstart='])).stdout.trim();
  if (snapshot !== process_.uidAndStart) throw Error('Reviewed process incarnation changed; refusing');
}
for (const listener of plan.listeners) {
  const host = listener.host === '::1' ? '[::1]' : listener.host;
  const args = ['-nP', '-a', '-p', String(listener.pid), '-i' + listener.transport.toUpperCase() + '@' + host + ':' + listener.port, ...(listener.transport === 'tcp' ? ['-sTCP:LISTEN'] : []), '-F0p'];
  await execute('/usr/sbin/lsof', args);
}
const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
const output = await open('owned-lo0.pcap', flags, 0o600), errors = await open('capture.stderr', flags, 0o600);
const child = spawn(plan.executable, plan.arguments, {stdio:['ignore', output.fd, 'pipe']});
let ready = false, completedDuration = false, stderr = '', duration, hard, stderrWrites = Promise.resolve();
const interrupt = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT'); if (!hard) hard = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const startup = setTimeout(interrupt, 5000);
child.stderr.on('data', chunk => { stderrWrites = stderrWrites.then(() => errors.write(chunk)); stderrWrites.catch(() => interrupt()); stderr = (stderr + chunk).slice(-8192); if (!ready && /listening on lo0/.test(stderr)) { ready = true; clearTimeout(startup); writeFile('capture-ready.json', JSON.stringify({runID:plan.runID,planSHA256:expected,ready:true}), {mode:0o600,flag:'wx'}).catch(() => interrupt()); duration = setTimeout(() => { completedDuration = true; interrupt(); }, plan.durationSeconds * 1000); } });
const exit = await new Promise(resolve => { child.once('error', error => resolve({spawnError:error.code ?? error.message})); child.once('exit', (code,signal) => resolve({code,signal})); });
clearTimeout(startup); clearTimeout(duration); clearTimeout(hard);
await stderrWrites; await output.close(); await errors.close();
const receipt = {schema:'P05_SCOPED_CAPTURE_EXECUTION_V1',runID:plan.runID,planSHA256:expected,ready,completedDuration,exit,bytes:(await stat('owned-lo0.pcap')).size,stderr:stderr.slice(-2048),targetVerdict:'INCOMPLETE',gaps:plan.gaps};
await writeFile('capture-receipt.json',JSON.stringify(receipt,null,2)+'\\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify(receipt)); process.exitCode = ready && completedDuration && exit.code === 0 ? 2 : 1;
`;
  const scriptPath = join(directory, 'execute-reviewed-capture.mjs');
  await writeFile(scriptPath, script, { mode: 0o700, flag: 'wx' });
  return { directory, planSHA256: sha256, script: scriptPath, scriptSHA256: createHash('sha256').update(script).digest('hex'), reviewedCommand: [process.execPath, scriptPath, '--execute-reviewed-plan', sha256], executed: false, automaticallyElevates: false, targetVerdict: 'INCOMPLETE' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { readFile } = await import('node:fs/promises');
  try { const configuration = JSON.parse(await readFile(process.argv[2], 'utf8')); process.stdout.write(JSON.stringify(await prepareOwnedListenerCapture(configuration, resolve(process.argv[3]))) + '\n'); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
