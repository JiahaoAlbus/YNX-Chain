// Backend-only product caller. Original Auth supplies the genuine fixed Native
// binding; this module neither loads another Native module nor authenticates a
// JavaScript object as Source. Never serialize the owning/partial into the UI.
/** @typedef {import('@ynx-chain/wallet-auth/auth-native-contract').OriginalAuthIDENativeBinding} NativeBinding */
/** @typedef {import('@ynx-chain/wallet-auth/auth-native-contract').OriginalIDEIdentityReceiveOwner | import('@ynx-chain/wallet-auth/auth-native-contract').OriginalIDEIdentityRecoveryOwner | import('@ynx-chain/wallet-auth/auth-native-contract').OriginalIDEProtectedKeyCallOwner} NativeOwner */
const operations = Object.freeze(/** @type {const} */ ({
  receive: ['receiveOriginalIDEIdentity', 'receive'],
  recover: ['recoverOriginalIDEIdentity', 'recover'],
  keyCall: ['acquireOriginalIDEProtectedKeyCall', 'keyCall'],
}));
/** @param {string} code */
const failure = code => Object.assign(new Error(code), { code });
/** @param {unknown} value */
const successful = value => {
  if (value !== undefined) throw failure('IDE_IDENTITY_NATIVE_RESULT_INVALID');
};

// One instance is one explicitly selected product operation. A retry requires
// a new user action after confirmed cleanup; no constructor/proof/invoke replay.
export class OriginalIDEIdentityCall {
  #binding; #actualEntryURL; #contract; #started;
  /** @type {NativeOwner | undefined} */ #owner;
  #proofSelected; #invokeSelected; #retired; #joined; #closeSelected; #closed; #failed;
  /** @type {unknown} */ #firstCause;
  /** @type {keyof typeof operations | undefined} */ #kind;
  #closeFailurePresent = false;
  /** @type {unknown} */ #closeFailure;
  /** @param {{binding:NativeBinding | null, actualEntryURL:string,
   * contract:typeof import('@ynx-chain/wallet-auth/auth-identity-contract')}} input */
  constructor({ binding, actualEntryURL, contract }) {
    this.#binding = binding; this.#actualEntryURL = actualEntryURL; this.#contract = contract;
    this.#started = false; this.#owner = undefined; this.#proofSelected = false;
    this.#invokeSelected = false; this.#retired = false; this.#joined = false;
    this.#closeSelected = false; this.#closed = false; this.#failed = false;
    this.#firstCause = undefined; this.#kind = undefined;
  }
  /** @param {unknown} error @returns {never} */
  #fail(error) {
    if (!this.#failed) { this.#failed = true; this.#firstCause = error; }
    throw this.#firstCause;
  }
  /** @template T @param {()=>T} action @returns {T} */
  #enter(action) {
    if (this.#retired || this.#failed || this.#closed) throw this.#failed ? this.#firstCause : failure('IDE_IDENTITY_CALL_RETIRED');
    try { return action(); } catch (error) { return this.#fail(error); }
  }
  /** @param {keyof typeof operations} kind @param {string} [invocationOriginal] */
  begin(kind, invocationOriginal) {
    if (this.#started) throw failure('IDE_IDENTITY_CALL_ALREADY_SELECTED');
    if (!Object.hasOwn(operations, kind) || (kind !== 'keyCall' && invocationOriginal !== undefined)) throw failure('IDE_IDENTITY_CALL_INVALID');
    this.#started = true; this.#kind = kind;
    return this.#enter(() => {
      // Store the SAME partial before any potentially failing late assertion.
      if (kind === 'keyCall') {
        const construct = this.#binding?.acquireOriginalIDEProtectedKeyCall;
        if (typeof construct !== 'function') throw failure('IDE_IDENTITY_NATIVE_UNAVAILABLE');
        if (typeof invocationOriginal !== 'string') throw failure('IDE_IDENTITY_CALL_INVALID');
        this.#owner = construct.call(this.#binding, this.#actualEntryURL, invocationOriginal);
      } else if (kind === 'recover') {
        const construct = this.#binding?.recoverOriginalIDEIdentity;
        if (typeof construct !== 'function') throw failure('IDE_IDENTITY_NATIVE_UNAVAILABLE');
        this.#owner = construct.call(this.#binding, this.#actualEntryURL);
      } else {
        const construct = this.#binding?.receiveOriginalIDEIdentity;
        if (typeof construct !== 'function') throw failure('IDE_IDENTITY_NATIVE_UNAVAILABLE');
        this.#owner = construct.call(this.#binding, this.#actualEntryURL);
      }
      successful(this.#owner.assertReady());
      return undefined;
    });
  }
  request() {
    return this.#enter(() => {
      if (!this.#owner || !this.#kind || this.#proofSelected) throw failure('IDE_IDENTITY_REQUEST_UNAVAILABLE');
      successful(this.#owner.current());
      const original = this.#owner.copyRequestOriginal();
      // Sole public SDK schema and E codec. No renderer-supplied expectedRaw,
      // clock, principal, Root or nonce is accepted as an argument here.
      const body = this.#contract.parseOriginalAuthIdentityRequest(original);
      if (body.purpose !== this.#contract.AUTH_IDENTITY_PURPOSES[operations[this.#kind][1]])
        throw failure('IDE_IDENTITY_PURPOSE_MISMATCH');
      const message = this.#contract.encodeOriginalAuthIdentityRequest(body);
      successful(this.#owner.current());
      return Object.freeze({ original, message: new Uint8Array(message), dataOnly: true, authorized: false });
    });
  }
  /** @param {Uint8Array} memberWire */
  completeProof(memberWire) {
    return this.#enter(() => {
      if (!this.#owner || this.#proofSelected) throw failure('IDE_IDENTITY_PROOF_ALREADY_SELECTED');
      if (!(memberWire instanceof Uint8Array) || !(memberWire.buffer instanceof ArrayBuffer))
        throw failure('IDE_IDENTITY_PROOF_BYTES_REQUIRED');
      successful(this.#owner.current());
      // Selection precedes the genuine Native call even if it throws UNKNOWN.
      this.#proofSelected = true;
      successful(this.#owner.completeProof(new Uint8Array(memberWire)));
      successful(this.#owner.current());
    });
  }
  result() {
    return this.#enter(() => {
      if (!this.#owner || !this.#proofSelected || (this.#kind === 'keyCall' && !this.#invokeSelected))
        throw failure('IDE_IDENTITY_RESULT_UNAVAILABLE');
      successful(this.#owner.current());
      const result = this.#owner.result(); // backend-only unknown, no invented DTO
      successful(this.#owner.current());
      return result;
    });
  }
  invoke() {
    return this.#enter(() => {
      if (!this.#owner || this.#kind !== 'keyCall' || !this.#proofSelected || this.#invokeSelected)
        throw failure('IDE_IDENTITY_INVOCATION_UNAVAILABLE');
      successful(this.#owner.current());
      this.#invokeSelected = true;
      const owner = /** @type {import('@ynx-chain/wallet-auth/auth-native-contract').OriginalIDEProtectedKeyCallOwner} */ (this.#owner);
      const result = owner.invoke(); // SAME captured call, zero arguments
      successful(this.#owner.current());
      return result;
    });
  }
  retire() {
    if (this.#retired) return;
    this.#retired = true; // Immediately refuse late UI/proof callbacks.
    if (this.#owner) { try { successful(this.#owner.retire()); } catch (error) { this.#fail(error); } }
  }
  join() {
    if (!this.#retired) throw failure('IDE_IDENTITY_RETIRE_REQUIRED');
    if (this.#joined) return;
    if (this.#owner) successful(this.#owner.join()); // pending is retryable join, never business replay
    this.#joined = true;
  }
  close() {
    if (!this.#retired || !this.#joined) throw failure('IDE_IDENTITY_JOIN_REQUIRED');
    if (this.#closeSelected) {
      if (this.#closeFailurePresent) throw this.#closeFailure;
      return;
    }
    this.#closeSelected = true;
    try { if (this.#owner) successful(this.#owner.close()); this.#closed = true; }
    catch (error) {
      this.#closeFailurePresent = true; this.#closeFailure = error;
      if (!this.#failed) { this.#failed = true; this.#firstCause = error; }
      throw error;
    }
  }
  /** @returns {Readonly<import('@ynx-chain/wallet-auth/auth-native-contract').OriginalAuthNativeStatus>} */
  status() {
    // Actual Native status remains independent of our local retirement or a
    // caught exception. In particular UNKNOWN is never converted into success.
    let code;
    try { code = Object.getOwnPropertyDescriptor(this.#firstCause, 'code')?.value; } catch {}
    return this.#owner?.status() ?? Object.freeze({ phase: 'partial', ready: false,
      unknown: false, retired: this.#retired, cleanupComplete: this.#closed,
      disposed: this.#closed, firstCauseCode: this.#failed && typeof code === 'string' && /^[A-Z0-9_]{1,128}$/.test(code)
        ? code : this.#failed ? 'IDE_IDENTITY_CALL_FAILED' : null });
  }
}
