import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTemporaryTLS } from './temporary-tls.mjs';
import { startSyntheticEndpoints } from './synthetic-endpoints.mjs';
import { startScopedSocksFixture } from './scoped-socks-fixture.mjs';
import { inspectExactClientBinary, observeDedicatedClient, rawCapturePermissionProbe } from './scoped-collector.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const alive = child => child.exitCode === null && child.signalCode === null;

function launch(executable, args) {
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', bytes => { output.stdout = (output.stdout + bytes.toString()).slice(-16384); });
  child.stderr.on('data', bytes => { output.stderr = (output.stderr + bytes.toString()).slice(-16384); });
  const exit = new Promise(resolveExit => { child.once('exit', (code, signal) => resolveExit({ code, signal })); child.once('error', error => resolveExit({ spawnError: error.code ?? error.message })); });
  return { child, output, exit, stop: async () => {
    if (!alive(child)) return { requested: false, ...await exit };
    child.kill('SIGTERM'); const timeout = setTimeout(() => { if (alive(child)) child.kill('SIGKILL'); }, 2000);
    try { return { requested: true, requestedSignal: 'SIGTERM', ...await exit }; } finally { clearTimeout(timeout); }
  } };
}

async function readOwnBrowserEvents(runID) {
  const filename = join(tmpdir(), `ynx-p05-probe-${runID}`, 'browser-events.json');
  try { const bytes = await readFile(filename); const value = JSON.parse(bytes); if (value.runID !== runID) throw new Error('Native event run binding mismatch'); return { filename, sha256: digest(bytes), value }; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function runInstalledProbeIntegration({ executable, expectedSHA256, sourceHEAD, outputDirectory }) {
  if (process.platform !== 'darwin' || !outputDirectory?.startsWith('/') || !/^[a-f0-9]{40}$/.test(sourceHEAD ?? '')) throw new Error('macOS, exact source HEAD and absolute owned output directory are required');
  const binary = await inspectExactClientBinary(executable, expectedSHA256);
  const moduleID = `c-native-${randomBytes(6).toString('hex')}`, directory = join(outputDirectory, moduleID);
  await mkdir(directory, { mode: 0o700 });
  const result = { schema: 'YNX_INSTALLED_SYNTHETIC_PROBE_INTEGRATION_V1', moduleID, startedAt: Date.now(), executable, binarySHA256: binary.actualSHA256, sourceHEAD, directory, evidenceClass: 'installed-binary-synthetic-fixture', malformed: [], scenarios: [], rawCapture: await rawCapturePermissionProbe(), targetVerdict: 'INCOMPLETE', productionRouteAdmission: false, opensRouteMode: false, ordinaryQAProcessAttached: false, globalSettingsChanged: false };
  for (const [name, args] of [['malformed-run-flag', ['--p05-synthetic-run']], ['manifest-only', [`--p05-probe-manifest=${join(directory, 'not-consumed.json')}`]]]) {
    const owned = launch(executable, args);
    const deadline = setTimeout(() => { if (alive(owned.child)) owned.child.kill('SIGTERM'); }, 5000);
    try { const exit = await owned.exit; result.malformed.push({ name, pid: owned.child.pid, args, exit, rejectionObserved: exit.code === 78, stderr: owned.output.stderr }); }
    finally { clearTimeout(deadline); if (alive(owned.child)) await owned.stop(); }
  }
  if (result.malformed.some(value => !value.rejectionObserved)) {
    result.firstCause = 'Installed binary did not reject every malformed synthetic invocation with 78; live probe launches stopped';
    await writeFile(join(directory, 'integration-receipt.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); return result;
  }
  const certificates = await createTemporaryTLS();
  try {
    for (const scenario of ['normal-tls-rejection', 'socks-connect-refusal']) {
      const runID = `c-${randomBytes(8).toString('hex')}`;
      let target, socks, owned;
      const observed = { scenario, runID, startedAt: Date.now(), sourceHEAD, binarySHA256: binary.actualSHA256, targetVerdict: 'INCOMPLETE' };
      try {
        target = await startSyntheticEndpoints({ tls: certificates, runID });
        socks = await startScopedSocksFixture({ hostname: target.manifest.hostname, targetPort: target.manifest.https.port, refuseConnections: scenario === 'socks-connect-refusal' });
        const manifest = { runID, initialURL: `https://${target.manifest.hostname}:${target.manifest.https.port}/probe?probe=native-${runID}`, routePort: socks.endpoint.port, allowedHosts: [target.manifest.hostname], durationSeconds: 12 };
        const manifestPath = join(directory, `${runID}-manifest.json`), manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
        await writeFile(manifestPath, manifestBytes, { mode: 0o600, flag: 'wx' });
        observed.manifest = manifest; observed.manifestPath = manifestPath; observed.manifestSHA256 = digest(manifestBytes);
        owned = launch(executable, [`--p05-synthetic-run=${runID}`, `--p05-probe-manifest=${manifestPath}`]);
        observed.pid = owned.child.pid;
        const end = Date.now() + 7000; let observationMade = false;
        while (Date.now() < end && alive(owned.child)) {
          const native = await readOwnBrowserEvents(runID);
          if (native && native.value.events.some(event => event.kind === 'loading') && !observationMade) {
            try { observed.scopedObservation = await observeDedicatedClient({ rootPID: owned.child.pid, executable, expectedSHA256, runID, routeEndpoints: [socks.endpoint], syntheticTargets: [target.manifest.https], samples: 5 }); }
            catch (error) { observed.collectorError = error.message; }
            observationMade = true;
          }
          if (native?.value.events.some(event => event.kind === 'blocked') && observationMade && Date.now() - observed.startedAt > 2000) break;
          await pause(100);
        }
        observed.cancel = await owned.stop();
        const native = await readOwnBrowserEvents(runID);
        observed.nativeEvents = native;
        if (native && (native.value.pid !== observed.pid || native.value.manifestSHA256 !== observed.manifestSHA256)) throw new Error('Installed native PID/manifest readback mismatch');
        observed.childOutput = owned.output;
        observed.socksRecords = [...socks.records]; observed.controlledTargetRecords = [...target.records];
        observed.domainInSocksRequest = socks.records.some(record => record.kind === 'connect-request' && record.addressType === 'domain' && record.hostname === target.manifest.hostname);
        observed.proxyConnectedToControlledTarget = socks.records.some(record => record.kind === 'target-connected');
        observed.httpReceipts = target.records.filter(record => record.kind === 'receipt' && ['https', 'wss', 'download'].includes(record.protocol)).length;
        observed.browserReportedBlocked = !!native?.value.events.some(event => event.kind === 'blocked');
        observed.browserErrorDetails = native?.value.events.filter(event => event.kind === 'blocked').map(event => event.detail) ?? [];
        observed.webKitAttributionMissing = observed.scopedObservation?.identity.missing ?? ['webkit-network', 'webkit-webcontent'];
        observed.notes = ['Temporary CA was NOT trusted by WebKit or OS', 'SOCKSv5 instrument is a fixture, not Tor/Nym', 'FD sampling and a domain SOCKS request do not prove DNS/UDP/WebRTC non-emission', 'Owned UI child was explicitly cancelled; unproven launchd XPC identities were not touched'];
      } catch (error) { observed.firstCause = error.message; }
      finally {
        if (owned && alive(owned.child)) observed.cancel = await owned.stop();
        if (socks) await socks.close(); if (target) await target.close();
        observed.endedAt = Date.now(); result.scenarios.push(observed);
        await writeFile(join(directory, `${runID}-receipt.json`), JSON.stringify(observed, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      }
    }
  } finally { await certificates.cleanup(); }
  result.endedAt = Date.now(); result.cleanup = { installedChildrenExited: result.scenarios.every(value => value.cancel && (value.cancel.code !== undefined || value.cancel.signal)), scopedFixtureServersClosed: true, temporaryTLSKeysRemoved: true, nativeEvidenceDirectoriesPreserved: true };
  await writeFile(join(directory, 'integration-receipt.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return result;
}

async function main(args) {
  const value = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const result = await runInstalledProbeIntegration({ executable: value('--executable'), expectedSHA256: value('--sha256'), sourceHEAD: value('--source-head'), outputDirectory: value('--output-directory') });
  process.stdout.write(JSON.stringify({ receipt: join(result.directory, 'integration-receipt.json'), malformed: result.malformed.map(value => ({ name: value.name, code: value.exit.code })), scenarios: result.scenarios.map(value => ({ scenario: value.scenario, pid: value.pid, firstCause: value.firstCause, domainInSocksRequest: value.domainInSocksRequest, proxyConnectedToControlledTarget: value.proxyConnectedToControlledTarget, browserErrorDetails: value.browserErrorDetails, httpReceipts: value.httpReceipts, webKitAttributionMissing: value.webKitAttributionMissing, cancel: value.cancel })), targetVerdict: result.targetVerdict, opensRouteMode: false }) + '\n');
  process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
export { launch as launchOwnedInstalledProbe, readOwnBrowserEvents };
