import { fork, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createTemporaryTLS } from './temporary-tls.mjs';
import { startSyntheticEndpoints } from './synthetic-endpoints.mjs';
import { collectOwnedSnapshot, rawCapturePermissionProbe, inspectExactClientBinary, observeDedicatedClient } from './scoped-collector.mjs';
const execute = promisify(execFile), helperPath = fileURLToPath(new URL('./fixtures/owned-client-helper.mjs', import.meta.url));

async function launchOwnedHelper(configuration) {
  const child = fork(helperPath, ['root'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let ready;
  try { ready = await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Owned helper startup timed out')), 5000);
    child.once('message', value => { clearTimeout(timeout); resolveReady(value); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.send({ type: 'init', configuration });
  }); } catch (error) { child.kill('SIGKILL'); throw error; }
  let counter = 0;
  const request = value => new Promise((resolveReply, reject) => {
    const id = `parent-${++counter}`, timeout = setTimeout(() => { child.off('message', receive); reject(new Error('Owned helper action timed out')); }, 8000);
    const receive = reply => { if (reply.id !== id) return; clearTimeout(timeout); child.off('message', receive); if (reply.error) reject(new Error(reply.error)); else resolveReply(reply); };
    child.on('message', receive); child.send({ ...value, id });
  });
  return { child, ready, request, stop: async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.send({ type: 'stop' });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await exited; } finally { clearTimeout(timeout); }
  } };
}

export async function runOwnedFaultPlan({ injectDirectNegative = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('This owned process collector targets macOS');
  const tls = await createTemporaryTLS(); let endpoints;
  const result = { schema: 'YNX_OWNED_HELPER_FAULT_RECEIPT_V1', evidenceClass: 'isolated-helper', collectorKind: 'OS process/FD snapshot + controlled target observer', rawCapture: await rawCapturePermissionProbe(), testsRealWebKit: false, actualWiFiChanged: false, actualSystemSleep: false, targetVerdict: 'INCOMPLETE', opensRouteMode: false, scenarios: [] };
  try {
    endpoints = await startSyntheticEndpoints({ tls });
    result.syntheticManifest = endpoints.manifest;
    result.helperSourceSHA256 = createHash('sha256').update(await readFile(helperPath)).digest('hex');
    for (const scenario of ['baseline', 'killroute', 'wifiswitch', 'sleepwake', 'crash']) {
      let helper;
      try {
        helper = await launchOwnedHelper({ hostname: endpoints.manifest.hostname, targetPort: endpoints.manifest.https.port, ca: tls.ca.toString() });
        const { rootPID, routePID, networkPID, routePort, executable } = helper.ready;
        const roles = { [rootPID]: 'helper-ui-supervisor', [routePID]: 'helper-route', [networkPID]: 'helper-network' };
        const parameters = { rootPID, expectedExecutable: executable, roles, routeEndpoints: [{ host: '127.0.0.1', port: routePort }], syntheticTargets: [endpoints.manifest.https] };
        const observed = { scenario, identity: { rootPID, routePID, networkPID, executable, roleClass: 'Node synthetic helpers; not WebKit UI/Network/WebContent' }, baseline: await helper.request({ type: 'probe', probeID: `${scenario}-before` }) };
        observed.before = await collectOwnedSnapshot(parameters);
        observed.routeEntrySocketObserved = observed.before.sockets.some(socket => socket.role === 'helper-network' && socket.destinationClass === 'route-entry');
        observed.routeTargetSocketObserved = observed.before.sockets.some(socket => socket.role === 'helper-route' && socket.destinationClass === 'synthetic-target');
        if (scenario !== 'baseline') {
          observed.fault = await helper.request({ type: 'fault', scenario });
          const beforeCount = endpoints.records.length;
          observed.postFaultProbe = await helper.request({ type: 'probe', probeID: `${scenario}-after` });
          observed.after = await collectOwnedSnapshot(parameters);
          observed.targetReceiptsAfterBlockedProbe = endpoints.records.slice(beforeCount).filter(record => record.kind === 'receipt' && record.probeID === `${scenario}-after`).length;
          if (scenario === 'killroute' && injectDirectNegative) {
            observed.negative = await helper.request({ type: 'probe', probeID: `${scenario}-intentional-direct-negative`, forceDirect: true });
            observed.negativeSnapshot = await collectOwnedSnapshot(parameters);
            observed.actualDirectTargetSocketDetected = observed.negativeSnapshot.sockets.some(socket => socket.role === 'helper-network' && socket.destinationClass === 'synthetic-target');
            observed.intentionalDirectTargetReceipt = endpoints.records.some(record => record.probeID === `${scenario}-intentional-direct-negative`);
          }
        }
        try { await execute('/bin/launchctl', ['procinfo', String(rootPID)], { maxBuffer: 64 * 1024 }); observed.responsibilityAPI = { available: false, reason: 'Result requires a reviewed attribution decoder; raw output not retained' }; }
        catch (error) { observed.responsibilityAPI = { available: false, exit: error.code, error: (error.stderr ?? error.stdout ?? '').trim().slice(0, 512) }; }
        result.scenarios.push(observed);
      } finally { if (helper) await helper.stop(); }
    }
    result.targetRecords = endpoints.records;
    result.observedHelperContract = result.scenarios.every(scenario => scenario.baseline.targetHTTP200 && scenario.routeEntrySocketObserved && scenario.routeTargetSocketObserved && (scenario.scenario === 'baseline' || (scenario.fault.readback.state === 'blocked' && scenario.postFaultProbe.dispatched === false && scenario.targetReceiptsAfterBlockedProbe === 0)));
    result.negativeDetected = !injectDirectNegative ? 'NOT_REQUESTED' : result.scenarios.some(scenario => scenario.actualDirectTargetSocketDetected && scenario.intentionalDirectTargetReceipt);
    return result;
  } finally { if (endpoints) await endpoints.close(); await tls.cleanup(); }
}

async function main(args) {
  if (args[0] === '--local-faults' && args[1] === '--output' && args[2]) {
    const result = await runOwnedFaultPlan({ injectDirectNegative: args.includes('--intentional-direct-negative') });
    await writeFile(resolve(args[2]), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify({ output: resolve(args[2]), observedHelperContract: result.observedHelperContract, negativeDetected: result.negativeDetected, rawCapture: result.rawCapture, targetVerdict: result.targetVerdict, opensRouteMode: false }) + '\n');
    process.exitCode = result.observedHelperContract ? 0 : 1; return;
  }
  if (args[0] === '--preflight-client' && args[1] && args[2] === '--sha256' && args[3]) {
    process.stdout.write(JSON.stringify(await inspectExactClientBinary(resolve(args[1]), args[3]), null, 2) + '\n'); process.exitCode = 2; return;
  }
  if (args[0] === '--observe-client' && args[1]) {
    const config = JSON.parse(await readFile(resolve(args[1]), 'utf8'));
    if (!config.output?.startsWith('/')) throw new Error('An absolute receipt output path is required');
    const result = await observeDedicatedClient(config);
    await writeFile(config.output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify({ output: config.output, targetVerdict: result.targetVerdict, opensRouteMode: false }) + '\n'); process.exitCode = 2; return;
  }
  throw new Error('Usage: owned-fault-runner.mjs --local-faults --output receipt.json [--intentional-direct-negative] | --preflight-client /exact/executable --sha256 SHA256');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
