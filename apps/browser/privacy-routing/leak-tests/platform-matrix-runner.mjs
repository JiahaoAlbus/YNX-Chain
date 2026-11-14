import { readFile, writeFile, mkdir, rename, readdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTemporaryTLS } from './temporary-tls.mjs';
import { startSyntheticEndpoints } from './synthetic-endpoints.mjs';
import { startPublicNonceFixture } from './public-nonce-fixture.mjs';
import { startScopedSocksFixture } from './scoped-socks-fixture.mjs';
import { inspectExactClientBinary, observeDedicatedClient } from './scoped-collector.mjs';
import { launchOwnedInstalledProbe, readOwnBrowserEvents } from './installed-probe-runner.mjs';
import { buildWebKitBootstrap } from './platform-probe/bootstrap.mjs';
import { startApprovedQuickTunnel } from './platform-probe/quick-tunnel.mjs';
import { attributeOwnedSocksConnection } from './platform-probe/owned-endpoint-attribution.mjs';
import { waitForApprovedFixture } from './platform-probe/tunnel-readiness.mjs';
import { prepareOwnedListenerCapture } from './platform-probe/capture-plan.mjs';
import { correlateOwnedStunSenders } from './platform-probe/owned-stun-attribution.mjs';

const pause = value => new Promise(resolve_ => setTimeout(resolve_, value));
const hash = value => createHash('sha256').update(value).digest('hex');
const fresh = prefix => prefix + randomBytes(6).toString('hex');
const alive = child => child.exitCode === null && child.signalCode === null;
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
    const listeners = [target.manifest.https, { ...target.manifest.stun, transport: 'udp' }, ...(socks ? [socks.endpoint] : []), ...(target.manifest.ipv6.stun ? [{ ...target.manifest.ipv6.stun, transport: 'udp' }] : [])].map(value => ({ transport: 'tcp', ...value, pid: process.pid }));
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
    result.faultAt = Date.now();
    if (socks) { await socks.close(); result.fault = 'Closed all owned SOCKS listener/tunnel sockets'; }
    else result.fault = 'Direct negative control retains direct transport; after-fault phase is observer calibration, not protected-routing claim';
    await atomic(phaseControlFile, { runID, sequence: 2, phase: 'after-fault' });
    const faultEnd = Date.now() + 7000;
    while (Date.now() < faultEnd && alive(owned.child)) {
      const postFault = target.records.filter(event => event.at > result.faultAt);
      const ownedSocketPIDs = result.connectionAttribution?.identities.filter(identity => identity.appleWebKitCode).map(identity => identity.pid) ?? [];
      if (identityTool && ownedSocketPIDs.length && !result.afterFaultStunSourceCorrelation && postFault.some(event => event.protocol === 'stun')) result.afterFaultStunSourceCorrelation = await correlateOwnedStunSenders({ runID, records: postFault, identityTool, ownedSocketPIDs });
      await pause(100);
    }
    result.native = await readOwnBrowserEvents(runID); result.targetRecords = [...target.records]; result.publicRecords = fixture ? [...fixture._records] : [];
    const nativeDirectory = join(tmpdir(), `ynx-p05-probe-${runID}`);
    result.downloads = [];
    for (const name of (await readdir(nativeDirectory)).filter(name => name.startsWith('download-'))) { const data = await readFile(join(nativeDirectory, name)); result.downloads.push({ filename: name, bytes: data.length, sha256: hash(data), expectedMatch: fixture ? hash(data) === fixture.expectedSHA256.download : false }); }
    result.postFaultPublicReceipts = result.publicRecords.filter(event => event.probeID?.startsWith('after-fault-'));
    result.realStunReceipts = result.targetRecords.filter(event => event.protocol === 'stun');
    result.socksRecords = socks ? [...socks.records] : [];
    const routedSourcePorts = result.socksRecords.filter(event => event.kind === 'target-connected').map(event => event.upstreamSourcePort);
    result.targetTCP = result.targetRecords.filter(event => event.kind === 'tcp-accepted').map(event => ({ ...event, matchedOwnedSocksUpstream: routedSourcePorts.includes(event.peerPort) }));
    result.afterFaultTargetTCP = result.targetTCP.filter(event => event.at > result.faultAt);
    result.directControlObserved = direct && result.realStunReceipts.length > 0;
    if (!direct && (result.postFaultPublicReceipts.length || result.realStunReceipts.length || result.afterFaultTargetTCP.length)) result.targetVerdict = 'FAIL';
  } catch (error) { result.firstCause = error.message; result.native = await readOwnBrowserEvents(runID); }
  finally { result.cancel = await owned.stop(); if (socks && !result.fault) await socks.close(); }
  await writeFile(join(directory, 'receipt.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); return result;
}

export async function runPlatformMatrix({ candidatePath, outputDirectory, approvalReference, identityTool, localRoutedOnly = false, waitReviewedCapture = false, publicOnly = false }) {
  if (localRoutedOnly && publicOnly) throw new Error('Select one matrix scope');
  if (!localRoutedOnly && !approvalReference) throw new Error('Existing explicit human authorization reference is required before public resource provisioning');
  if (waitReviewedCapture && !localRoutedOnly) throw new Error('Reviewed administrator capture gate is restricted to the isolated local-routed matrix');
  const candidateBytes = await readFile(candidatePath), candidate = JSON.parse(candidateBytes), { executable, signedExecutableSHA256 } = candidate;
  await inspectExactClientBinary(executable, signedExecutableSHA256);
  const directory = join(outputDirectory, fresh('c-platform-')); await mkdir(directory, { mode: 0o700 });
  const result = { schema: 'P05_REAL_WEBKIT_PLATFORM_MATRIX_V2', candidate, candidateSHA256: hash(candidateBytes), directory, evidenceClass: 'real-installed-WebKit-with-controlled-fixtures', publicTunnelLimit: localRoutedOnly ? 0 : 2, approvalReference, tunnels: [], targetVerdict: 'INCOMPLETE', productionRouteAdmission: false };
  if (identityTool) result.identityHelper = { path: identityTool, sha256: hash(await readFile(identityTool)) };
  const certificates = await createTemporaryTLS(); let local, publicFixture; const tunnels = [];
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
    if (localRoutedOnly) return result;
    const runID = fresh('c-public-'); publicFixture = await startPublicNonceFixture({ runID, lifetimeSeconds: 300 });
    // Reserve this original two-process authorization exactly once. Errors/UNKNOWN retain the
    // reservation and receipts; callers reconcile rather than silently provision replacements.
    const budgetPath = join(outputDirectory, 'c-tunnel-approval-' + hash(approvalReference).slice(0, 20) + '.json');
    await writeFile(budgetPath, JSON.stringify({ schema: 'P05_PUBLIC_TUNNEL_BUDGET_RESERVATION_V1', approvalReference, runID, maximumProcesses: 2, reservedAt: Date.now(), directory, automaticReplacementAllowed: false }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    result.publicBudgetReservation = budgetPath;
    const emptyConfig = join(directory, 'empty-cloudflared.yml'); await writeFile(emptyConfig, '{}\n', { mode: 0o600, flag: 'wx' });
    for (let index = 0; index < 2; index++) tunnels.push(await startApprovedQuickTunnel({ cloudflared: '/opt/homebrew/bin/cloudflared', emptyConfig, localPort: publicFixture.endpoint.port, approvalReference, lifetimeSeconds: 300 }));
    result.publicReadiness = await waitForApprovedFixture({ tunnels, fixture: publicFixture });
    const origins = result.publicReadiness.origins; result.publicOrigins = origins;
    if (result.publicReadiness.ready) {
      const manifest = publicFixture.manifest(); result.publicFixtureManifest = manifest;
        local = await startSyntheticEndpoints({ tls: certificates, runID });
        const socks = await startScopedSocksFixture({ hostname: new URL(origins[0]).hostname, targetPort: 443, publicFixture: manifest.publicFixture, holdConnectMilliseconds: 1500 });
        result.routedFixture = await runNativePhases({ executable, expectedSHA256: signedExecutableSHA256, runID, directory: join(directory, 'routed'), target: local, fixture: { ...manifest, _records: publicFixture.records }, socks, identityTool });
        if (result.routedFixture.targetVerdict === 'FAIL') result.targetVerdict = 'FAIL';
    } else result.firstCause = result.publicReadiness.firstCause;
  } finally {
    for (const tunnel of tunnels) { await tunnel.stop(); result.tunnels.push({ pid: tunnel.pid, origin: tunnel.origin, registered: tunnel.registered, args: tunnel.args, startedAt: tunnel.startedAt, deadlineAt: tunnel.deadlineAt, events: tunnel.events }); }
    if (local) await local.close(); if (publicFixture) { result.finalPublicRecords = [...publicFixture.records]; await publicFixture.close(); }
    await certificates.cleanup();
    result.cleanup = 'Only owned Native children, fixture sockets, cloudflared children and temporary test keys cleaned; native evidence preserved';
    await writeFile(join(directory, 'matrix-receipt.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = flag => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
  runPlatformMatrix({ candidatePath: value('--candidate'), outputDirectory: value('--output-directory'), approvalReference: value('--approval-reference'), identityTool: value('--identity-tool'), localRoutedOnly: process.argv.includes('--local-routed-only'), waitReviewedCapture: process.argv.includes('--wait-reviewed-capture'), publicOnly: process.argv.includes('--public-only') }).then(result => { process.stdout.write(JSON.stringify({ receipt: join(result.directory, 'matrix-receipt.json'), directFirstCause: result.directControl?.firstCause, directReady: result.directControl?.instrumentReadyObserved, localRoutedReady: result.localRouted?.instrumentReadyObserved, localRoutedFirstCause: result.localRouted?.firstCause, publicOrigins: result.publicOrigins, firstCause: result.firstCause, routedReady: result.routedFixture?.instrumentReadyObserved, routedFirstCause: result.routedFixture?.firstCause, targetVerdict: result.targetVerdict }) + '\n'); process.exitCode = result.targetVerdict === 'FAIL' ? 1 : 2; }).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
}
