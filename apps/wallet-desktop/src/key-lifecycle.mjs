import { AsyncLocalStorage } from "node:async_hooks";

export function keyAccessError(code = "WALLET_LOCKED") {
  const messages = { WALLET_LOCKED: "Unlock Wallet with system authentication before continuing.", SECURE_UNLOCK_UNAVAILABLE: "Secure system unlock is unavailable on this platform. Keys remain locked.", WALLET_OPERATION_CANCELLED: "Wallet locked or this operation changed. Review and authorize again.", WALLET_OPERATION_BUSY: "Finish or cancel the current Wallet operation first.", UNLOCK_CANCELLED: "System authentication was cancelled or failed. Wallet remains locked." };
  return Object.assign(new Error(messages[code] ?? messages.WALLET_OPERATION_CANCELLED), { code: 4100, data: { code } });
}

/** This is an application authorization gate, not OS cipher/TEE key binding. */
export function nativeDesktopAuthorizer({ platform = process.platform, systemPreferences } = {}) {
  return Object.freeze({
    available: () => platform === "darwin" && typeof systemPreferences?.promptTouchID === "function" && systemPreferences.canPromptTouchID?.() === true,
    authenticate: () => systemPreferences.promptTouchID("unlock YNX Wallet for reviewed account operations"),
    method: platform === "darwin" ? "macos-touch-id-application-gate" : "unavailable",
  });
}

export class DesktopKeyLifecycle {
  #context = new AsyncLocalStorage();
  #generation = 0; #locked = true; #account = null; #focused = false;
  #authenticating = false; #ownedDialog = false; #active = null; #listeners = new Set();
  constructor({ authorizer = nativeDesktopAuthorizer(), now = Date.now, focused = () => this.#focused, ttlMs = 120_000 } = {}) {
    this.authorizer = authorizer; this.now = now; this.focused = focused; this.ttlMs = ttlMs;
  }
  status() {
    let available = false; try { available = this.authorizer.available() === true; } catch {}
    return Object.freeze({ locked: this.#locked, revision: this.#generation, authenticating: this.#authenticating, account: this.#account, unlockAvailable: available, unlockMethod: this.authorizer.method, hardwareBound: false });
  }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #notify() { for (const listener of this.#listeners) listener(this.status()); }
  lock() { this.#locked = true; this.#generation++; this.#notify(); }
  cancelOperations() { this.#generation++; this.#notify(); }
  setAccount(account) { if (this.#account !== account) { this.#account = account; this.lock(); } }
  setFocused(value) { this.#focused = value === true; if (!value && !this.#authenticating && !this.#ownedDialog) this.lock(); }
  async unlock() {
    if (this.#authenticating || this.#active) throw keyAccessError("WALLET_OPERATION_BUSY");
    if (!this.status().unlockAvailable) throw keyAccessError("SECURE_UNLOCK_UNAVAILABLE");
    if (!this.focused()) throw keyAccessError();
    const generation = this.#generation, deadline = this.now() + this.ttlMs;
    this.#authenticating = true; this.#notify();
    try {
      await this.authorizer.authenticate();
      if (generation !== this.#generation || !this.focused() || this.now() >= deadline) throw keyAccessError("WALLET_OPERATION_CANCELLED");
      this.#locked = false;
      return this.status();
    } catch (error) { this.#locked = true; this.#generation++; throw error?.data?.code ? error : keyAccessError("UNLOCK_CANCELLED"); }
    finally { this.#authenticating = false; this.#notify(); }
  }
  assertUnlocked() { if (this.#locked || !this.focused()) throw keyAccessError(); }
  current() { const lease = this.#context.getStore(); if (!lease) throw keyAccessError(); lease.assert(); return lease; }
  async run(operation) {
    this.assertUnlocked();
    if (this.#active) throw keyAccessError("WALLET_OPERATION_BUSY");
    const generation = this.#generation, account = this.#account, deadline = this.now() + this.ttlMs;
    let submitted = false, delivered = false;
    const assertLive = () => { if (this.#active !== lease || this.#locked || !this.focused() || this.#generation !== generation || this.#account !== account || this.now() >= deadline) throw keyAccessError("WALLET_OPERATION_CANCELLED"); };
    const external = async (kind, action) => {
      assertLive();
      if (delivered || (kind === "submit" && submitted)) throw keyAccessError("WALLET_OPERATION_CANCELLED");
      if (kind === "submit") submitted = true; else delivered = true;
      // No key step may begin after an outward effect starts. Its ACK may arrive
      // after blur/lock; that does not undo the already-started effect.
      try { return await action(); }
      catch {
        throw Object.assign(new Error("External delivery started but its outcome is unconfirmed. Check the destination before trying again."), { code: 4900, data: { code: "EXTERNAL_OUTCOME_UNKNOWN", effect: kind, outcomeUnknown: true } });
      }
    };
    const lease = Object.freeze({
      account,
      assert: () => { assertLive(); if (submitted || delivered) throw keyAccessError("WALLET_OPERATION_CANCELLED"); },
      step: async action => { lease.assert(); const result = await action(); if (!submitted && !delivered) lease.assert(); return result; },
      submit: action => external("submit", action),
      deliver: action => external("deliver", action),
    });
    this.#active = lease;
    try { return await this.#context.run(lease, async () => { lease.assert(); const result = await operation(lease); if (!submitted && !delivered) lease.assert(); return result; }); }
    finally { if (this.#active === lease) this.#active = null; }
  }
  // Only the app's own file dialog may transiently take focus. No secret work
  // occurs while it is unfocused, and a screen lock always invalidates the lease.
  async withOwnedDialog(operation) {
    const lease = this.current(); this.#ownedDialog = true;
    try { const result = await operation(); lease.assert(); return result; }
    finally { this.#ownedDialog = false; if (!this.focused()) this.lock(); }
  }
}
