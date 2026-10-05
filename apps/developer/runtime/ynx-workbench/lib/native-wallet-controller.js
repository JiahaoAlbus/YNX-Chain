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
const PAUSED_WALLET_ADMISSION = Object.freeze({ assertCurrent() { const error = Error('Wallet online connection is not open yet. Local development remains available.'); error.code = 'WALLET_ONLINE_ADMISSION_PAUSED'; throw error; } });
class NativeWalletController {
  constructor(api, emit = () => {}, admission = PAUSED_WALLET_ADMISSION) {
    this.api = api; this.admission = admission; this.emit = emit; this.epoch = 0; this.disposed = false; this.runtime = undefined; this.inFlight = undefined; this.callback = undefined;
    this.state = Object.freeze({ phase: 'idle', busy: false, awaitingCallback: false, session: { status: 'disconnected', message: '' }, sessionCurrent: false, message: '', projectCapability: 'not-supplied' });
    this.unsubscribe = api.subscribeDeveloperWalletCallbacks(url => this.receiveCallback(url));
  }
  publish(patch) { if (!this.disposed) { this.state = Object.freeze({ ...this.state, ...patch, projectCapability: 'not-supplied' }); this.emit(this.state); } }
  async inspect() {
    const epoch = this.epoch;
    try { const result = await this.api.inspectDeveloperWalletV2Runtime(); if (epoch === this.epoch) this.publish({ available: result.available, source: result.source, message: result.available ? 'Explicit connection is required. Existing sessions have not been restored.' : result.reason }); }
    catch (error) { if (epoch === this.epoch) this.publish({ available: false, message: error.message }); }
  }
  connect() { return this.run('connect'); }
  restore() { return this.run('restore'); }
  disconnect() { return this.run('disconnect'); }
  resumeCallback() { if (!this.callback) return Promise.resolve(); return this.run('return'); }
  run(action, existingRuntime) {
    if (this.disposed || this.inFlight || (this.state.awaitingCallback && !existingRuntime)) return Promise.resolve();
    const epoch = ++this.epoch;
    this.publish({ phase: existingRuntime ? 'verifying' : 'approving', busy: true, awaitingCallback: false, message: '' });
    let runtime = existingRuntime;
    const method = action === 'connect' ? 'beginYNX' : action === 'return' ? 'handleReturn' : action;
    const admit = async () => {
      // This interface must be supplied by a trusted owner-bound service, never
      // a project file, browser global or SDK registry entry. No supplier exists
      // in this package yet, so the default is an explicit paused dependency.
      const asserted = await this.admission.assertCurrent({ service: 'wallet-product-session-v2', productId: 'developer', platform: 'macos', gatewayOrigin: this.api.DEVELOPER_WALLET_V2_SOURCE.gatewayOrigin, operation: method });
      if (asserted !== undefined && asserted !== true) throw Error('Wallet service admission was not verified.');
    };
    const operation = Promise.resolve().then(async () => {
      await admit();
      runtime ||= await this.api.beginDeveloperWalletV2Connection();
      if (this.disposed || epoch !== this.epoch) { await runtime.endNativeOperation(); return; }
      this.runtime = runtime;
      const binding = runtime.connection.connectionBinding;
      if (binding?.productId !== 'developer' || binding.platform !== 'macos' || binding.applicationId !== 'com.ynxweb4.developer.testnetpreview') throw Error('Native Wallet returned a different registered product binding.');
      this.publish({ phase: action === 'return' ? 'verifying' : action === 'restore' ? 'restoring' : action === 'disconnect' ? 'disconnecting' : 'requesting', source: runtime.source });
      await admit();
      let result;
      if (action === 'return') { const url = this.callback; if (!url) throw Error('No Wallet return is pending.'); result = await runtime.connection.handleReturn(url); }
      else if (action === 'restore') result = await runtime.connection.restore();
      else if (action === 'disconnect') result = await runtime.connection.disconnect();
      else result = await runtime.connection.beginYNX();
      if (this.disposed || epoch !== this.epoch) { await runtime.endNativeOperation(); return; }
      await admit();
      const awaitingCallback = result?.status === 'wallet-opened';
      this.publish({ phase: awaitingCallback ? 'wallet-opened' : 'ready', busy: false, awaitingCallback, session: publicSessionState(result, runtime), sessionCurrent: true, message: result?.message || '' });
      if (action === 'return') { this.callback = undefined; this.publish({ hasPendingReturn: false }); }
      if (!awaitingCallback) { await runtime.endNativeOperation(); if (this.runtime === runtime) this.runtime = undefined; }
    }).catch(async error => {
      if (runtime) await runtime.endNativeOperation().catch(() => {});
      if (this.runtime === runtime) this.runtime = undefined;
      if (epoch === this.epoch) this.publish({ phase: error.code === 'WALLET_ONLINE_ADMISSION_PAUSED' ? 'paused' : 'error', busy: false, awaitingCallback: false, sessionCurrent: false, message: error.message || 'Wallet operation failed.' });
    }).finally(() => {
      if (this.inFlight === operation) this.inFlight = undefined;
      if (!this.disposed && epoch !== this.epoch) this.publish({ busy: false });
      if (!this.disposed && this.state.awaitingCallback && this.callback && this.runtime) void this.run('return', this.runtime);
    });
    this.inFlight = operation; return operation;
  }
  receiveCallback(url) {
    if (this.disposed || typeof url !== 'string' || url.length > 4096 || !url.length) return;
    // Never decode an approval or infer identity in the UI. The SDK owns the
    // exact registered route, nonce, binding, expiry and signature checks.
    if (this.callback && this.callback !== url) { this.publish({ message: 'A different Wallet return is already pending. Restore explicitly to reconcile protected state.' }); return; }
    this.callback = url; this.publish({ hasPendingReturn: true });
    if (!this.inFlight && this.runtime && this.state.awaitingCallback) void this.run('return', this.runtime);
    else if (!this.inFlight) this.publish({ message: 'A Wallet return is waiting. Review it explicitly; no connection approval was inferred.' });
  }
  async cancel() {
    ++this.epoch;
    const runtime = this.runtime; this.runtime = undefined;
    this.publish({ phase: 'cancelled', busy: Boolean(this.inFlight), awaitingCallback: false, sessionCurrent: false, message: 'Cancelled locally. Protected pending/session records were preserved; restore is explicit.' });
    if (runtime) await runtime.endNativeOperation().catch(() => {});
  }
  async guest() {
    await this.cancel();
    const epoch = this.epoch;
    const result = await this.api.enterDeveloperWalletV2Guest();
    if (epoch === this.epoch && result.available) this.publish({ phase: 'guest', session: publicSessionState(result), message: result.sessionState.message, source: result.source });
  }
  dispose() { if (this.disposed) return Promise.resolve(); const cleanup = this.cancel(); this.disposed = true; this.unsubscribe(); this.callback = undefined; return cleanup; }
}
module.exports = { NativeWalletController, publicSessionState, PAUSED_WALLET_ADMISSION };
