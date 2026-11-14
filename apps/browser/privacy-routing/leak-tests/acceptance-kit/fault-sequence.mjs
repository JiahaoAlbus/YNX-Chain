// The bridge is provided by Native's real BrowserRouteProtection acceptance entry. Tests may
// exercise orchestration only; a fixture/fake bridge can never become platform acceptance.
const SHA = /^[a-f0-9]{64}$/;
export const REQUIRED_FAULTS = Object.freeze(['route-loss', 'webcontent-crash', 'provider-crash', 'provider-disabled', 'sleepwake', 'network-switch']);
const isTargetRequest = event => ['receipt', 'stream-started', 'redirect-issued'].includes(event.kind);
const USER_RETRY_PROBE = /^user-retry-(https|long-wss|stream-download|redirect-same|redirect-cross|redirect-http|cross-origin|plain-ws)$/;
const validPort = value => Number.isInteger(value) && value >= 1024 && value <= 65535;

function ownedIngress(owned, runID) {
  const manifest = owned.manifest;
  if (!Array.isArray(owned.records) || manifest?.schema !== 'YNX_SYNTHETIC_ENDPOINTS_V1' ||
      manifest.runID !== runID || manifest.hostname !== `${runID}.leak.test` ||
      !['LISTENING', 'UNAVAILABLE_NOT_COVERED'].includes(manifest.ipv6?.status)) {
    throw new Error('Owned loopback observer must match the protected fixture run');
  }
  const ports = {};
  for (const [family, host, scope] of [['ipv4', '127.0.0.1', manifest], ['ipv6', '::1', manifest.ipv6]]) {
    if (family === 'ipv6' && scope.status !== 'LISTENING') continue;
    ports[family] = {};
    for (const protocol of ['https', 'dns', 'stun']) {
      const endpoint = scope[protocol];
      if (endpoint?.host !== host || !validPort(endpoint.port)) throw new Error('Exact owned loopback listener required');
      ports[family][protocol] = endpoint.port;
    }
  }
  const records = owned.records;
  return start => records.slice(start).filter(event => {
    if (event?.actor !== 'target' || event.runID !== runID || event.hostname !== manifest.hostname) return false;
    const observed = Object.hasOwn(ports, event.addressFamily) && ports[event.addressFamily];
    if (!observed) return false;
    if (event.kind === 'tcp-accepted' && event.protocol === 'tcp') return event.localPort === observed.https;
    const host = event.addressFamily === 'ipv4' ? '127.0.0.1' : '::1';
    if (event.targetHost !== host || event.targetPort !== observed[event.protocol]) return false;
    return (event.kind === 'dns' && event.protocol === 'dns' && Number.isInteger(event.transactionID) &&
        event.transactionID >= 0 && event.transactionID <= 65535) ||
      (event.kind === 'receipt' && event.protocol === 'stun' && /^[a-f0-9]{24}$/.test(event.transactionID));
  });
}
function binding(value) {
  if (!value || value.consumer !== 'BrowserRouteProtection' || !['tor', 'nym'].includes(value.mode) || !SHA.test(value.executableSHA256 ?? '') || !SHA.test(value.rootAuditTokenSHA256 ?? '') || !SHA.test(value.manifestSHA256 ?? '') || !value.runID || !value.epoch || !value.providerGeneration || !Number.isSafeInteger(value.rootPID) || value.rootPID <= 1) throw new Error('Actual dedicated Native process/control binding required');
  return value;
}
export async function driveInFlightFault({ bridge, fixture, ownedEndpoints, fault, wait, quietMilliseconds = 5000 }) {
  if (!REQUIRED_FAULTS.includes(fault) || typeof wait !== 'function' || quietMilliseconds < 5000) throw new Error('Exact fault and bounded observation required');
  const identity = binding(await bridge.binding());
  if (identity.runID !== fixture.manifest().runID) throw new Error('Fixture run differs from actual protected process');
  const readOwnedIngress = ownedEndpoints && ownedIngress(ownedEndpoints, identity.runID);
  const journal = { schema: 'P05_PROTECTED_INFLIGHT_FAULT_V1', identity, fault, steps: [], evidenceClass: 'bridge observations require independently scoped OS verification', targetVerdict: 'INCOMPLETE', productionRouteAdmission: false,
    loopbackTargetObserver: ownedEndpoints ? 'owned-listener-arrival-only' : 'NOT_SUPPLIED',
    requiredIndependentGates: ['signed NE sourceApp/sourceProcess canary', 'scoped synthetic DNS/UDP/IPv6 coverage including zero-loss window', 'actual flow drops and download final-file readback', 'OS provider crash/disable behavior'] };
  function recordUnexpectedTarget(records) {
    journal.targetVerdict = 'FAIL';
    journal.firstCause ??= 'Unexpected target request before explicit retry';
    journal.unexpectedTargetReceipts = records;
  }
  async function finishAfterUnexpectedTarget(records) {
    recordUnexpectedTarget(records);
    try { journal.nativeEvidence = await bridge.finishEvidence(); }
    catch (error) { journal.cleanupFailure = error.message; throw error; }
    return journal;
  }
  try {
  await bridge.explicitPhase('baseline');
  const inflight = await bridge.waitForInFlight({ wssMinimumFrames: 2, downloadMinimumBytes: 16384, downloadMustBeUncommitted: true });
  if (!(inflight.wssFrames >= 2 && inflight.downloadBytes >= 16384 && inflight.downloadCommitted === false)) throw new Error('Fault requires real WSS and unfinished native download');
  journal.steps.push({ kind: 'baseline-inflight', ...inflight });
  // Implementation must own/review the exact route/WebContent/provider instance. No process-name
  // search, PID-only signal, kill-other-app, privilege elevation or system switch is done here.
  // Take the target cursor before sending the command. Native stdout receipt time cannot
  // locate a target request during the fault. New requests in this ambiguous span fail closed.
  const targetCursor = fixture.records.length;
  const ingressCursor = ownedEndpoints?.records.length ?? 0;
  const arrivals = (start = targetCursor) => [...fixture.records.slice(start).filter(isTargetRequest), ...(readOwnedIngress?.(ingressCursor) ?? [])];
  const applied = await bridge.applyReviewedFault(fault);
  if (applied.fault !== fault || applied.runID !== identity.runID || !SHA.test(applied.actionReceiptSHA256 ?? '')) throw new Error('Actual fault action receipt missing');
  journal.steps.push({ kind: 'fault', ...applied });
  const blocked = await bridge.waitForBlocked();
  if (blocked.runID !== identity.runID || blocked.epoch !== identity.epoch || blocked.state !== 'blocked' || !Number.isFinite(blocked.at) || blocked.at < applied.at) throw new Error('Matching actual blocked readback required');
  journal.steps.push({ kind: 'blocked-readback', ...blocked });
  const duringFault = arrivals();
  if (duringFault.length) return await finishAfterUnexpectedTarget(duringFault);
  await bridge.explicitPhase('fault-retry'); // Actual Native should reject before dispatch.
  const postBlock = arrivals();
  if (postBlock.length) return await finishAfterUnexpectedTarget(postBlock);
  const beforeRecovery = fixture.records.length;
  const recovered = typeof bridge.rebuildOriginalRouteQuiet === 'function'
    ? await bridge.rebuildOriginalRouteQuiet()
    : await bridge.rebuildOriginalRouteBlocked(); // Legacy reducer fixture contract, not a new permission.
  const quietState = recovered.state === 'blocked' || recovered.state === 'connected-no-target-phase' && recovered.targetDispatchState === 'idle-no-phase';
  if (recovered.mode !== identity.mode || !quietState || recovered.epoch === identity.epoch || !recovered.epoch || !recovered.providerGeneration || !Number.isFinite(recovered.at) || recovered.at < blocked.at) throw new Error('Fresh same-route quiet rebuild required');
  journal.steps.push({ kind: 'route-rebuilt-quiet', ...recovered });
  await wait(quietMilliseconds);
  const quiet = fixture.records.slice(beforeRecovery);
  journal.steps.push({ kind: 'recovery-idle-window', milliseconds: quietMilliseconds, records: quiet });
  const quietArrivals = arrivals(beforeRecovery);
  if (quietArrivals.length) return await finishAfterUnexpectedTarget(quietArrivals);
  // Exact user action receipt is generated by Native's explicit acceptance command; it is not
  // a fabricated claim that a human clicked. No automatic return to ready or target fallback.
  const request = await bridge.explicitUserRequest();
  if (!SHA.test(request.actionReceiptSHA256 ?? '')) throw new Error('Explicit request receipt required');
  const beforeDispatch = arrivals();
  if (beforeDispatch.length) return await finishAfterUnexpectedTarget(beforeDispatch);
  const retrySentAt = Date.now();
  const retryCursor = fixture.records.length;
  await bridge.explicitPhase('user-retry');
  journal.steps.push({ kind: 'explicit-retry', ...request });
  try { journal.nativeEvidence = await bridge.finishEvidence(); }
  catch (error) { journal.cleanupFailure = error.message; throw error; }
  finally {
    const afterFault = fixture.records.filter(event => event.at >= blocked.at && event.at < recovered.at);
    journal.postFaultReceipts = afterFault;
    // These wall-clock values supplement the target cursor and probe phase. They
    // do not establish synchronization with the native monotonic clock.
    const late = fixture.records.slice(retryCursor).filter(event => isTargetRequest(event) &&
      (!USER_RETRY_PROBE.test(event.probeID ?? '') || event.at < retrySentAt));
    // The explicit retry needs no direct connection to this separate local observer.
    // These receipts have no phase ID, so retain their target-only provenance.
    const ingress = readOwnedIngress?.(ingressCursor) ?? [];
    const unexpected = [...new Set([...afterFault.filter(isTargetRequest), ...late, ...ingress])];
    if (ingress.length && !afterFault.some(isTargetRequest) && !late.length)
      journal.firstCause ??= 'Unexpected owned loopback arrival after fault start';
    if (unexpected.length > 0) recordUnexpectedTarget(unexpected);
  }
  // Target writes alone (wss-frame-sent/stream-completed) do not prove client receipt: the peer
  // may have closed while server bytes remained buffered. Client/capture readback is separate.
  // A zero-hit trace, bridge Boolean, or self-reported signed/ready status cannot create PASS.
  return journal;
  } catch (error) {
    journal.firstCause ??= error.message;
    // Preserve applied effects and UNKNOWN: caller persists this before considering any next
    // operation. In particular, a provider crash cannot invent the old generation's close ACK.
    error.partialJournal = journal; throw error;
  }
}
