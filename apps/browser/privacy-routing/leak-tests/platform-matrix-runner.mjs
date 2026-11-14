import { readFile, writeFile, mkdir, rename, readdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTemporaryTLS } from './temporary-tls.mjs';
import { startSyntheticEndpoints } from './synthetic-endpoints.mjs';
import { startScopedSocksFixture } from './scoped-socks-fixture.mjs';
import { inspectExactClientBinary, observeDedicatedClient } from './scoped-collector.mjs';
import { launchOwnedInstalledProbe, readOwnBrowserEvents } from './installed-probe-runner.mjs';
import { buildWebKitBootstrap } from './platform-probe/bootstrap.mjs';
import { attributeOwnedSocksConnection } from './platform-probe/owned-endpoint-attribution.mjs';
import { prepareOwnedListenerCapture } from './platform-probe/capture-plan.mjs';
import { correlateOwnedStunSenders } from './platform-probe/owned-stun-attribution.mjs';

const pause = value => new Promise(resolve_ => setTimeout(resolve_, value));
const hash = value => createHash('sha256').update(value).digest('hex');
const fresh = prefix => prefix + randomBytes(6).toString('hex');
const alive = child => child.exitCode === null && child.signalCode === null;

// This legacy entry owns only self-controlled loopback capability diagnostics.
// Neither a caller string nor an installed/ready DTO supplies protection or
// public-resource authority. Protected traffic uses the existing Native opaque
// canary/lease entry; it cannot be selected into existence by this Node runner.
export function requireMatrixPurpose({ purpose, localRoutedOnly = false, publicOnly = false, approvalReference } = {}) {
  if (typeof localRoutedOnly !== 'boolean' || typeof publicOnly !== 'boolean') throw new Error('MATRIX_SCOPE_TYPE_REJECTED');
  if (purpose === 'protected-acceptance') throw new Error('PROTECTED_MATRIX_REQUIRES_INSTALLED_NATIVE_CANARY_AUTHORITY');
  if (purpose !== 'native-loopback-capability') throw new Error('EXPLICIT_MATRIX_PURPOSE_REQUIRED');
  if (publicOnly || approvalReference !== undefined) throw new Error('PUBLIC_MATRIX_REQUIRES_SEPARATELY_REVIEWED_RESOURCE_SCOPE');
  return Object.freeze({ purpose, evidenceClass: 'native-loopback-capability-diagnostic-only',
    publicResourceProvisioning: false, protectionInstalled: 'NOT_ESTABLISHED', productionRouteAdmission: false });
}
export function matrixOwnedListenerTuples(manifest, socksEndpoint, pid) {
  const tcp = [manifest.https, manifest.ipv6.https, socksEndpoint].filter(Boolean);
  const udp = [manifest.dns, manifest.stun, manifest.ipv6.dns, manifest.ipv6.stun].filter(Boolean);
  return [...tcp.map(value => ({ ...value, transport: 'tcp', pid })), ...udp.map(value => ({ ...value, transport: 'udp', pid }))];
}
export function recordMatrixTargetObservations(result, { manifest, direct = false }) {
  result.postFaultPublicReceipts = result.publicRecords.filter(event => event.probeID?.startsWith('after-fault-'));
  const postFault = result.targetRecords.slice(result.targetCursor);
  const familyScope = addressFamily =>
    addressFamily === 'ipv4' ? manifest : addressFamily === 'ipv6' ? manifest.ipv6 : undefined;
  const ownedUDP = (event, protocol, kind) => {
    if (event.actor !== 'target' || event.protocol !== protocol || event.kind !== kind ||
        event.runID !== manifest.runID || event.hostname !== manifest.hostname) return false;
    const endpoint = familyScope(event.addressFamily)?.[protocol];
    return endpoint && event.targetHost === endpoint.host && event.targetPort === endpoint.port;
  };
  const ownedTCP = event => event.kind === 'tcp-accepted' && event.actor === 'target' && event.protocol === 'tcp' &&
    event.runID === manifest.runID && event.hostname === manifest.hostname &&
    event.localPort === familyScope(event.addressFamily)?.https?.port && Number.isInteger(event.localPort);
  result.realStunReceipts = result.targetRecords.filter(event => ownedUDP(event, 'stun', 'receipt'));
  result.afterFaultOwnedDNS = postFault.filter(event => ownedUDP(event, 'dns', 'dns'));
  result.afterFaultOwnedSTUN = postFault.filter(event => ownedUDP(event, 'stun', 'receipt'));
  result.udpSourceAppAttribution = 'NOT_OBSERVED';
  result.udpEvidenceClass = 'owned-loopback-target-arrival-only';
  const routedSourcePorts = result.socksRecords.filter(event => event.kind === 'target-connected').map(event => event.upstreamSourcePort);
  const withUpstreamCorrelation = event => ({ ...event, matchedOwnedSocksUpstream: routedSourcePorts.includes(event.peerPort) });
  result.targetTCP = result.targetRecords.filter(ownedTCP).map(withUpstreamCorrelation);
  // The cursor is taken before closing the fixture. Wall-clock equality or adjustment does not
  // move a pre-cutoff arrival across that boundary. TCP accept is target evidence only.
  result.afterFaultTargetTCP = postFault.filter(ownedTCP).map(withUpstreamCorrelation);
  result.directControlObserved = direct && (result.realStunReceipts.length > 0 || result.afterFaultOwnedDNS.length > 0);
  if (!direct && (result.postFaultPublicReceipts.length || result.realStunReceipts.length ||
      result.afterFaultOwnedDNS.length || result.afterFaultTargetTCP.length)) result.targetVerdict = 'FAIL';
}
async function atomic(filename, value) { const temporary = filename + '.next'; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, filename); }
async function waitFor(runID, child, predicate, milliseconds) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end && alive(child)) { const events = await readOwnBrowserEvents(runID); if (events && predicate(events.value.events)) return events; await pause(100); }
  return await readOwnBrowserEvents(runID);
}
async function runNativePhases({ executable, expectedSHA256, runID, directory, target, fixture, socks, identityTool, direct = false, waitReviewedCapture = false }) {
  await mkdir(directory, { mode: 0o700 });
  const bootstrap = buildWebKitBootstrap({ runID, httpsPort: target.manifest.https.port, stunPort: target.manifest.stun.port, stunIPv6Port: target.manifest.ipv6.stun?.port, publicFixture: fixture?.publicFixture, expectedWssSHA256: fixture?.expectedSHA256.wss });
  const bootstrapPath = join(directory, 'bootstrap.html'), readinessFile = join(directory, 'collector-ready.json'), phaseControlFile = join(directory, 'phase.json'), manifestPath = join(directory, 'manifest.json');
  await writeFile(bootstrapPath, bootstrap.html, { mode: 0o600, flag: 'wx' });
  const baseURL = fixture ? fixture.origins[0] : `https://${runID}.leak.test`;
  const plan = { runID, initialURL: fixture ? fixture.origins[0] + fixture.paths.proof : `https://${runID}.leak.test:${target.manifest.https.port}/probe`, routePort: socks?.endpoint.port ?? 19050, allowedHosts: fixture ? fixture.origins.map(origin => new URL(origin).hostname) : [`${runID}.leak.test`, `frame.${runID}.leak.test`], durationSeconds: 60, bootstrap: { path: bootstrapPath, sha256: bootstrap.sha256, baseURL }, readinessFile, phaseControlFile, ...(fixture ? { publicFixture: fixture.publicFixture } : {}), transport: direct ? 'direct-negative-control' : 'socks5' };
  const bytes = Buffer.from(JSON.stringify(plan, null, 2)); await writeFile(manifestPath, bytes, { mode: 0o600, flag: 'wx' });
  const owned = launchOwnedInstalledProbe(executable, [`--p05-synthetic-run=${runID}`, `--p05-probe-manifest=${manifestPath}`]);
  const result = { runID, pid: owned.child.pid, plan, manifestSHA256: hash(bytes), targetVerdict: 'INCOMPLETE', routeClass: direct ? 'explicit-direct-negative-control' : 'restricted-fixture-SOCKS-NOT-Tor-or-Nym', unobserved: ['System-resolver DNS is not captured', 'Complete WebKit XPC sourceApp audit-token attribution requires installed NetworkExtension', 'Non-loopback egress is not captured'] };
  try {
    const listeners = matrixOwnedListenerTuples(target.manifest, socks?.endpoint, process.pid);
    result.administratorCaptureReview = await prepareOwnedListenerCapture({ runID, listeners, durationSeconds: 20 }, join(directory, 'reviewed-capture'));
    await waitFor(runID, owned.child, events => events.some(event => event.kind === 'waitingForCollector'), 4000);
    result.rootBeforeGate = await observeDedicatedClient({ rootPID: owned.child.pid, executable, expectedSHA256, runID, routeEndpoints: socks ? [socks.endpoint] : [], syntheticTargets: [target.manifest.https], samples: 1 });
    if (waitReviewedCapture) {
      process.stdout.write(JSON.stringify({ awaitingReviewedAdministratorCapture: result.administratorCaptureReview, seconds: 22, nativeHasNoWebKitYet: true }) + '\n');
      const readyPath = join(result.administratorCaptureReview.directory, 'capture-ready.json'), deadline = Date.now() + 22000;
      while (Date.now() < deadline) {
        try {
          const metadata = await lstat(readyPath), value = JSON.parse(await readFile(readyPath, 'utf8'));
          if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || (metadata.mode & 0o022) || Object.keys(value).sort().join(',') !== 'planSHA256,ready,runID' || value.runID !== runID || value.planSHA256 !== result.administratorCaptureReview.planSHA256 || value.ready !== true) throw new Error('Administrator capture readiness binding rejected');
          result.reviewedCaptureReady = true; break;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await pause(100);
      }
      if (!result.reviewedCaptureReady) throw new Error('Reviewed administrator capture not started within bound; cancelled before creating WebKit');
    }
    await atomic(readinessFile, { runID, manifestSHA256: hash(bytes), ready: true });
    const instrument = await waitFor(runID, owned.child, events => events.some(event => event.kind === 'instrument' && event.detail.includes('bootstrap-ready')), 7000);
    result.instrumentReadyObserved = !!instrument?.value.events.some(event => event.kind === 'instrument' && event.detail.includes('bootstrap-ready'));
    await atomic(phaseControlFile, { runID, sequence: 1, phase: 'baseline' });
    const baselineEnd = Date.now() + 7000;
    while (Date.now() < baselineEnd && alive(owned.child)) {
      if (socks && identityTool && !result.connectionAttribution && socks.records.some(event => event.kind === 'connect-request')) {
        const observed = await attributeOwnedSocksConnection({ port: socks.endpoint.port, runID, socksRecords: socks.records, identityTool, allowedHosts: plan.allowedHosts });
        if (observed.identities.length) result.connectionAttribution = observed;
      }
      const ownedSocketPIDs = result.connectionAttribution?.identities.filter(identity => identity.appleWebKitCode).map(identity => identity.pid) ?? [];
      if (identityTool && ownedSocketPIDs.length && !result.stunSourceCorrelation && target.records.some(event => event.protocol === 'stun')) result.stunSourceCorrelation = await correlateOwnedStunSenders({ runID, records: target.records, identityTool, ownedSocketPIDs });
      await pause(100);
    }
    result.baselineTarget = [...target.records]; result.baselinePublic = fixture ? [...fixture._records] : [];
    result.targetCursor = target.records.length;
    result.faultAt = Date.now();
    if (socks) { await socks.close(); result.fault = 'Closed all owned SOCKS listener/tunnel sockets'; }
    else result.fault = 'Direct negative control retains direct transport; after-fault phase is observer calibration, not protected-routing claim';
    await atomic(phaseControlFile, { runID, sequence: 2, phase: 'after-fault' });
    const faultEnd = Date.now() + 7000;
    while (Date.now() < faultEnd && alive(owned.child)) {
      const postFault = target.records.slice(result.targetCursor);
      const ownedSocketPIDs = result.connectionAttribution?.identities.filter(identity => identity.appleWebKitCode).map(identity => identity.pid) ?? [];
      if (identityTool && ownedSocketPIDs.length && !result.afterFaultStunSourceCorrelation && postFault.some(event => event.protocol === 'stun')) result.afterFaultStunSourceCorrelation = await correlateOwnedStunSenders({ runID, records: postFault, identityTool, ownedSocketPIDs });
      await pause(100);
    }
    result.native = await readOwnBrowserEvents(runID); result.targetRecords = [...target.records]; result.publicRecords = fixture ? [...fixture._records] : [];
    result.socksRecords = socks ? [...socks.records] : [];
    recordMatrixTargetObservations(result, { manifest: target.manifest, direct });
    const nativeDirectory = join(tmpdir(), `ynx-p05-probe-${runID}`);
    result.downloads = [];
    for (const name of (await readdir(nativeDirectory)).filter(name => name.startsWith('download-'))) { const data = await readFile(join(nativeDirectory, name)); result.downloads.push({ filename: name, bytes: data.length, sha256: hash(data), expectedMatch: fixture ? hash(data) === fixture.expectedSHA256.download : false }); }
  } catch (error) { result.firstCause = error.message; result.native = await readOwnBrowserEvents(runID); }
  finally { result.cancel = await owned.stop(); if (socks && !result.fault) await socks.close(); }
  await writeFile(join(directory, 'receipt.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); return result;
}

export async function runPlatformMatrix({ purpose, candidatePath, outputDirectory, approvalReference, identityTool, localRoutedOnly = false, waitReviewedCapture = false, publicOnly = false }) {
  // Before candidate IO, output mutation, certificates, listener or child.
  const execution = requireMatrixPurpose({ purpose, localRoutedOnly, publicOnly, approvalReference });
  if (waitReviewedCapture && !localRoutedOnly) throw new Error('Reviewed administrator capture gate is restricted to the isolated local-routed matrix');
  const candidateBytes = await readFile(candidatePath), candidate = JSON.parse(candidateBytes), { executable, signedExecutableSHA256 } = candidate;
  await inspectExactClientBinary(executable, signedExecutableSHA256);
  const directory = join(outputDirectory, fresh('c-platform-')); await mkdir(directory, { mode: 0o700 });
  const result = { schema: 'P05_REAL_WEBKIT_PLATFORM_MATRIX_V2', candidate, candidateSHA256: hash(candidateBytes), directory, ...execution, publicTunnelLimit: 0, tunnels: [], targetVerdict: 'INCOMPLETE', productionRouteAdmission: false };
  if (identityTool) result.identityHelper = { path: identityTool, sha256: hash(await readFile(identityTool)) };
  const certificates = await createTemporaryTLS(); let local;
  try {
    if (!localRoutedOnly && !publicOnly) {
      const directRun = fresh('c-direct-'); local = await startSyntheticEndpoints({ tls: certificates, runID: directRun });
      result.directControl = await runNativePhases({ executable, expectedSHA256: signedExecutableSHA256, runID: directRun, directory: join(directory, 'direct'), target: local, identityTool, direct: true });
      await local.close(); local = null;
    }
    if (!publicOnly) {
    const localRun = fresh('c-local-'); local = await startSyntheticEndpoints({ tls: certificates, runID: localRun });
    const localSocks = await startScopedSocksFixture({ hostname: `${localRun}.leak.test`, targetPort: local.manifest.https.port, holdConnectMilliseconds: 2000, allowSyntheticFrame: true });
    result.localRouted = await runNativePhases({ executable, expectedSHA256: signedExecutableSHA256, runID: localRun, directory: join(directory, 'local-routed'), target: local, socks: localSocks, identityTool, waitReviewedCapture });
    if (result.localRouted.targetVerdict === 'FAIL') result.targetVerdict = 'FAIL';
    await local.close(); local = null;
    }
  } finally {
    if (local) await local.close();
    await certificates.cleanup();
    result.cleanup = 'Only owned Native children, loopback fixture sockets and temporary test keys cleaned; native evidence preserved';
    await writeFile(join(directory, 'matrix-receipt.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = flag => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
  runPlatformMatrix({ purpose: value('--purpose'), candidatePath: value('--candidate'), outputDirectory: value('--output-directory'), approvalReference: value('--approval-reference'), identityTool: value('--identity-tool'), localRoutedOnly: process.argv.includes('--local-routed-only'), waitReviewedCapture: process.argv.includes('--wait-reviewed-capture'), publicOnly: process.argv.includes('--public-only') }).then(result => { process.stdout.write(JSON.stringify({ receipt: join(result.directory, 'matrix-receipt.json'), directFirstCause: result.directControl?.firstCause, directReady: result.directControl?.instrumentReadyObserved, localRoutedReady: result.localRouted?.instrumentReadyObserved, localRoutedFirstCause: result.localRouted?.firstCause, targetVerdict: result.targetVerdict }) + '\n'); process.exitCode = result.targetVerdict === 'FAIL' ? 1 : 2; }).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
}
