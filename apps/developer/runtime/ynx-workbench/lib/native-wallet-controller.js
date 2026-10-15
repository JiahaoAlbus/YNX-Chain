'use strict';
// UI lifecycle only. All authorization, persistence, callback validation and
// session truth remain in the original TS factory and canonical retained SDK.
function publicSessionState(result, runtime) {
  const state = result?.sessionState || runtime?.connection.current;
  return Object.freeze({ status: typeof state?.status === 'string' ? state.status : 'disconnected',
    message: typeof state?.message === 'string' ? state.message : '',
    account: state?.status === 'connected' && typeof state.session?.account === 'string' ? state.session.account : undefined,
    expiresAt: state?.status === 'connected' && typeof state.session?.expiresAt === 'string' ? state.session.expiresAt : undefined });
}
const MISSING_WALLET_ADMISSION = Object.freeze({ assertCurrent() { const error = Error('Wallet service has not been connected. Local development remains available.'); error.code = 'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED'; throw error; } });
// This code represents a pause reported by a trusted supplier, not its absence.
const PAUSED_WALLET_ADMISSION = Object.freeze({ assertCurrent() { const error = Error('Wallet online connection is not open yet. Local development remains available.'); error.code = 'WALLET_ONLINE_ADMISSION_PAUSED'; throw error; } });
class NativeWalletController {
  constructor(api, emit = () => {}, admission = MISSING_WALLET_ADMISSION) {
    this.api = api; this.admission = admission; this.emit = emit; this.epoch = 0; this.disposed = false; this.runtime = undefined; this.inFlight = undefined; this.callback = undefined; this.callbackQueue = []; this.returningCallback = undefined;
    this.state = Object.freeze({ phase: 'idle', serviceConfiguration: admission === MISSING_WALLET_ADMISSION ? 'not-supplied' : 'unverified', busy: false, awaitingCallback: false, session: { status: 'disconnected', message: '' }, sessionCurrent: false, message: '', projectCapability: 'not-supplied' });
    this.unsubscribe = api.subscribeDeveloperWalletCallbacks(url => this.receiveCallback(url), url => this.receiveResourceCallback(url));
  }
  publish(patch) { if (!this.disposed) { this.state = Object.freeze({ ...this.state, ...patch, projectCapability: 'not-supplied' }); this.emit(this.state); } }
  async inspect() {
    const epoch = this.epoch;
    try { const result = await this.api.inspectDeveloperWalletV2Runtime(); if (epoch === this.epoch) this.publish({ available: result.available, bridgeContract: result.bridgeContract, deviceStatus: 'not-observed', source: result.source, message: result.reason || '' }); }
    catch (error) { if (epoch === this.epoch) this.publish({ available: false, bridgeContract: 'check-failed', deviceStatus: 'not-observed', message: error.message }); }
  }
  connect() { return this.run('connect'); }
  restore() { return this.run('restore'); }
  disconnect() { return this.run('disconnect'); }
  resumeCallback() { if (!this.callback) return Promise.resolve(); return this.run('return'); }
  run(action, existingRuntime) {
    if (this.disposed || this.inFlight || (this.state.awaitingCallback && !existingRuntime)) return Promise.resolve();
    const epoch = ++this.epoch;
    let runtime = existingRuntime;
    const returnURL = action === 'return' ? this.callback : undefined;
    if (action === 'return') this.returningCallback = returnURL;
    const method = action === 'connect' ? 'beginYNX' : action === 'return' ? 'handleReturn' : action;
    const admit = async () => {
      // This interface must be supplied by a trusted owner-bound service, never
      // a project file, browser global or SDK registry entry. No supplier exists
      // in this package yet, so the default reports an unconnected dependency.
      const asserted = await this.admission.assertCurrent({ service: 'wallet-product-session-v2', productId: 'developer', platform: 'macos', gatewayOrigin: this.api.DEVELOPER_WALLET_V2_SOURCE.gatewayOrigin, operation: method });
      if (asserted !== undefined && asserted !== true) { const error = Error('Wallet service admission was not verified.'); error.code = 'WALLET_SERVICE_ADMISSION_INVALID'; throw error; }
      if (epoch === this.epoch) this.publish({ serviceConfiguration: 'verified' });
    };
    const operation = Promise.resolve().then(async () => {
      await admit();
      if (this.disposed || epoch !== this.epoch) return;
      runtime ||= await this.api.beginDeveloperWalletV2Connection();
      if (this.disposed || epoch !== this.epoch) { await runtime.endNativeOperation(); return; }
      this.runtime = runtime;
      const binding = runtime.connection.connectionBinding;
      if (binding?.productId !== 'developer' || binding.platform !== 'macos' || binding.applicationId !== 'com.ynxweb4.developer.testnetpreview') throw Error('Native Wallet returned a different registered product binding.');
      this.publish({ phase: action === 'return' ? 'verifying' : action === 'restore' ? 'restoring' : action === 'disconnect' ? 'disconnecting' : 'requesting', source: runtime.source });
      await admit();
      if (this.disposed || epoch !== this.epoch) return;
      let result;
      if (action === 'return') {
        if (!returnURL) throw Error('No Wallet return is pending.');
        if (this.classifyCallback(returnURL) === 'mismatch') throw Error('Wallet return does not match the current SDK request.');
        result = await runtime.connection.handleReturn(returnURL);
      }
      else if (action === 'restore') result = await runtime.connection.restore();
      else if (action === 'disconnect') result = await runtime.connection.disconnect();
      else result = await runtime.connection.beginYNX();
      if (this.disposed || epoch !== this.epoch) { await runtime.endNativeOperation(); return; }
      await admit();
      if (this.disposed || epoch !== this.epoch) return;
      const awaitingCallback = result?.status === 'wallet-opened';
      this.publish({ phase: awaitingCallback ? 'wallet-opened' : 'ready', busy: false, awaitingCallback, session: publicSessionState(result, runtime), sessionCurrent: true, message: result?.message || '' });
      if (action === 'return') { this.callbackQueue = this.callbackQueue.filter(url => url !== returnURL); this.callback = this.callbackQueue[0]; this.publish({ hasPendingReturn: Boolean(this.callback) }); }
      if (!awaitingCallback) { await runtime.endNativeOperation(); if (this.runtime === runtime) this.runtime = undefined; }
    }).catch(async error => {
      if (runtime) await runtime.endNativeOperation().catch(() => {});
      if (this.runtime === runtime) this.runtime = undefined;
      if (epoch === this.epoch) {
        const missing = error.code === 'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED', paused = error.code === 'WALLET_ONLINE_ADMISSION_PAUSED';
        this.publish({ phase: missing ? 'dependency-missing' : paused ? 'paused' : 'error', serviceConfiguration: missing ? 'not-supplied' : paused ? 'paused' : 'unverified', busy: false, awaitingCallback: false, sessionCurrent: false, failureCode: typeof error.code === 'string' ? error.code : undefined, message: error.message || 'Wallet operation failed.' });
      }
    }).finally(() => {
      if (this.inFlight !== operation) return;
      if (action === 'return' && this.returningCallback === returnURL) this.returningCallback = undefined;
      this.inFlight = undefined;
      if (!this.disposed && epoch !== this.epoch) this.publish({ busy: false });
      if (!this.disposed && !this.returningCallback) this.selectCurrentCallback();
      if (!this.disposed && this.state.awaitingCallback && this.callback && this.runtime && this.classifyCallback(this.callback) === 'current') void this.run('return', this.runtime);
    });
    // Render/dispose listeners may re-enter. Claim this exact request before
    // publishing so a cancelled old caller cannot overwrite a retry's owner.
    this.inFlight = operation;
    this.publish({ phase: existingRuntime ? 'verifying' : 'approving', busy: true, awaitingCallback: false, sessionCurrent: false, message: '', failureCode: undefined });
    return operation;
  }
  // Called only by the original request producer before review, never a return.
  setResourcePending(snapshot) {
    if (this.disposed || this.resourcePending) throw Error('An original resource operation is already pending or unavailable.');
    this.resourcePending = this.api.captureResourceOperation(snapshot);
    return this.resourcePending;
  }
  receiveResourceCallback(url) {
    if (this.disposed) return;
    if (!this.resourcePending) { this.publish({ resourceReturnStatus: 'rejected', resourceReturnError: 'No original resource operation is pending.' }); return; }
    try {
      const result = this.api.receiveResourceReturn(url, this.resourcePending, this.resourcePending);
      // A public observation only. Never overwrite Session callback, settle the
      // pending operation or present an unverified signature as service access.
      this.publish({ resourceReturnStatus: result.status, resourceReturnError: result.verification === 'supplier-unavailable' ? 'Resource signature verification is unavailable.' : '', resourceEffectAllowed: false });
    } catch { this.publish({ resourceReturnStatus: 'rejected', resourceReturnError: 'Resource return does not match the original operation.', resourceEffectAllowed: false }); }
  }
  classifyCallback(url) {
    if (!this.runtime || typeof this.api.classifyDeveloperWalletV2Return !== 'function') return 'pending';
    return this.api.classifyDeveloperWalletV2Return(this.runtime, url);
  }
  selectCurrentCallback() {
    // Bounded unentered UI observations only; protected requests remain in SDK.
    const candidates = this.callbackQueue.map(url => ({ url, status: this.classifyCallback(url) }));
    this.callbackQueue = candidates.filter(item => item.status !== 'mismatch').map(item => item.url);
    const current = candidates.find(item => item.status === 'current');
    this.callback = current?.url || this.callbackQueue[0];
    this.publish({ hasPendingReturn: Boolean(this.callback) });
    return Boolean(current);
  }
  receiveCallback(url) {
    if (this.api.isDeveloperResourceReturn?.(url)) { this.receiveResourceCallback(url); return; }
    if (this.disposed || typeof url !== 'string' || url.length > 4096 || !url.length) return;
    // Original SDK owns full validation; its current request only routes observations.
    // An unrelated callback must not select or release the active capability.
    if (this.classifyCallback(url) === 'mismatch') return;
    if (!this.callbackQueue.includes(url)) {
      if (this.callbackQueue.length >= 8) this.callbackQueue.shift();
      this.callbackQueue.push(url);
    }
    // Keep an already-entered return immutable; a later URL is only an observation.
    if (this.returningCallback) return;
    const current = this.selectCurrentCallback();
    if (!this.inFlight && this.runtime && this.state.awaitingCallback && current) void this.run('return', this.runtime);
    else if (!this.inFlight && this.callback) this.publish({ message: 'A Wallet return is waiting. Review it explicitly; no connection approval was inferred.' });
  }
  async cancel() {
    const epoch = ++this.epoch, operation = this.inFlight;
    const runtime = this.runtime; this.runtime = undefined;
    this.callbackQueue = []; this.callback = undefined;
    this.publish({ phase: 'cancelled', hasPendingReturn: false, busy: Boolean(this.inFlight), awaitingCallback: false, sessionCurrent: false, message: 'Cancelled locally. Protected pending/session records were preserved; restore is explicit.' });
    if (runtime) {
      let released = false;
      try { await runtime.endNativeOperation(); released = true; } catch { /* Unknown cleanup keeps the pending slot owned. */ }
      if (released && epoch === this.epoch && this.inFlight === operation) {
        // Only confirmed retirement of this exact native capability permits a
        // retry while its old SDK response drains. Protected records stay SDK-owned.
        this.inFlight = undefined; this.returningCallback = undefined;
        this.publish({ busy: false });
        if (!this.disposed && epoch === this.epoch && !this.inFlight) this.selectCurrentCallback();
      }
    }
  }
  async guest() {
    const epoch = this.epoch + 1;
    await this.cancel();
    if (this.disposed || epoch !== this.epoch) return;
    const result = await this.api.enterDeveloperWalletV2Guest();
    if (!this.disposed && epoch === this.epoch && result.available) this.publish({ phase: 'guest', session: publicSessionState(result), message: result.sessionState.message, source: result.source });
  }
  dispose() { if (this.disposed) return Promise.resolve(); const cleanup = this.cancel(); this.disposed = true; this.unsubscribe(); this.callback = undefined; return cleanup; }
}
module.exports = { NativeWalletController, publicSessionState, MISSING_WALLET_ADMISSION, PAUSED_WALLET_ADMISSION };
