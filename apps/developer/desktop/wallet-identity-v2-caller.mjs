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
  #proofSelected; #requestPrepared = false; #invokeSelected; #retired; #joined; #closeSelected; #closed; #failed;
  /** @type {unknown} */ #firstCause;
  /** @type {keyof typeof operations | undefined} */ #kind;
  #closeFailurePresent = false;
  /** @type {unknown} */ #closeFailure;
  #constructing = false; #ownerRetireSelected = false; #ownerRetireFailed = false;
  #nativeDepth = 0;
  #peer; #peerLoading; #peerKernel; #peerConstructing = false;
  #peerRetired = false; #peerRetireSelected = false; #peerRetireFailed = false; #peerRetireFailure;
  #peerJoined = false; #peerClosed = false; #peerCloseSelected = false; #peerCloseFailed = false; #peerCloseFailure;
  #peerSent = false; #peerReceived = false; #peerReturned;
  /** @type {unknown} */ #ownerRetireFailure;
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
    this.#assertLive();
    try { return action(); } catch (error) { return this.#fail(error); }
  }
  #assertLive() {
    if (this.#retired || this.#failed || this.#closed) throw this.#failed ? this.#firstCause : failure('IDE_IDENTITY_CALL_RETIRED');
  }
  /** @template T @param {()=>T} action @returns {T} */
  #native(action) {
    this.#nativeDepth++;
    try { return action(); } finally { this.#nativeDepth--; }
  }
  current() {
    return this.#enter(() => {
      if(!this.#owner)throw failure('IDE_IDENTITY_REQUEST_UNAVAILABLE');
      successful(this.#native(()=>this.#owner.current()));
      this.#assertLive();
    });
  }
  // Fixed original package only. No factory, module, provider or raw Native
  // owner is accepted through the product API or exposed to the renderer.
  openPeerCall() {
    this.#assertLive();
    this.#peerKernel??=import('../../../packages/wallet-auth/src/original-identity-peer-runtime.js').then(({OriginalIdentityPeerCall})=>{
      this.#assertLive();
      const view=Object.freeze({
        current:()=>this.#peerCurrent(),
        sendRequest:(kind,raw,invocation)=>this.#peerOperation('sendRequest',[kind,raw,invocation]),
        receiveReturn:()=>this.#peerOperation('receiveReturn',[]),
        retire:()=>this.#retirePeer(),join:()=>this.#joinPeer(),close:()=>this.#closePeer(),
      });
      return new OriginalIdentityPeerCall(this,view);
    });
    return this.#peerKernel;
  }
  #loadPeer() {
    this.#assertLive();
    if(!this.#owner||!this.#started)throw failure('IDE_IDENTITY_REQUEST_UNAVAILABLE');
    this.#peerLoading??=(async()=>{
      const original=await import('../../../packages/wallet-auth/src/original-ide-admission-parent-delivery.js');
      this.#assertLive();
      const acquire=original.acquireOriginalIDEIdentityPeerBinding;
      if(typeof acquire!=='function')throw failure('IDE_IDENTITY_PEER_UNAVAILABLE');
      const binding=this.#native(()=>acquire(this.#actualEntryURL));
      this.#assertLive();
      const construct=this.#native(()=>binding?.acquireOriginalIDEIdentityPeerChannel);
      this.#assertLive();
      if(typeof construct!=='function')throw failure('IDE_IDENTITY_PEER_UNAVAILABLE');
      this.#peerConstructing=true;
      try {
        // Preserve the returned SAME owning partial before any live/current
        // check or reentrant cancellation can fail. This is the sole factory.
        this.#peer=this.#native(()=>construct.call(binding,this.#actualEntryURL,this.#owner));
      }finally{this.#peerConstructing=false;}
      if(this.#peerRetired||this.#retired)this.#retirePeer();
      this.#assertLive();
      if(!this.#peer)throw failure('IDE_IDENTITY_PEER_UNAVAILABLE');
      successful(this.#native(()=>this.#peer.current()));
      this.#assertLive();return this.#peer;
    })().catch(error=>this.#fail(error));
    return this.#peerLoading;
  }
  async #peerCurrent() {
    try {const peer=await this.#loadPeer();this.#assertLive();successful(this.#native(()=>peer.current()));this.#assertLive();}
    catch(error){this.#fail(error);}
  }
  async #peerOperation(method,args) {
    try {
      const peer=await this.#loadPeer();this.#assertLive();
      const operation=this.#native(()=>peer[method]);this.#assertLive();
      if(typeof operation!=='function')throw failure('IDE_IDENTITY_PEER_UNAVAILABLE');
      if(method==='sendRequest'){
        if(this.#peerSent)throw failure('IDE_IDENTITY_PEER_SEND_ALREADY_SELECTED');this.#peerSent=true;
      }else{if(this.#peerReceived)throw failure('IDE_IDENTITY_PEER_RETURN_ALREADY_SELECTED');this.#peerReceived=true;}
      const value=await this.#native(()=>operation.apply(peer,args));
      // Keep a received frame even if cancellation/current invalidates its
      // consumer immediately afterwards. EOF/UNKNOWN is never an approval.
      if(method==='receiveReturn')this.#peerReturned=value;
      this.#assertLive();
      if(method==='sendRequest')successful(value);
      return value;
    }catch(error){this.#fail(error);}
  }
  #retirePeer() {
    this.#peerRetired=true;
    if(!this.#peer)return;
    if(this.#peerRetireSelected){if(this.#peerRetireFailed)throw this.#peerRetireFailure;return;}
    this.#peerRetireSelected=true;
    try{successful(this.#native(()=>this.#peer.retire()));}
    catch(error){this.#peerRetireFailed=true;this.#peerRetireFailure=error;throw error;}
  }
  async #joinPeer() {
    if(!this.#peerRetired)throw failure('IDE_IDENTITY_RETIRE_REQUIRED');
    if(this.#peerConstructing||this.#nativeDepth)throw failure('IDE_IDENTITY_JOIN_PENDING');
    // Wait only for our entered getter/factory, never create/replay an owner.
    if(this.#peerLoading)await this.#peerLoading.catch(()=>{});
    if(this.#peerJoined)return;
    if(this.#peer)successful(this.#native(()=>this.#peer.join()));
    this.#peerJoined=true;
  }
  #closePeer() {
    if(!this.#peerRetired||!this.#peerJoined)throw failure('IDE_IDENTITY_JOIN_REQUIRED');
    if(this.#nativeDepth)throw failure('IDE_IDENTITY_CLOSE_PENDING');
    if(this.#peerCloseSelected){if(this.#peerCloseFailed)throw this.#peerCloseFailure;return;}
    this.#peerCloseSelected=true;
    try{if(this.#peer)successful(this.#native(()=>this.#peer.close()));this.#peerClosed=true;}
    catch(error){this.#peerCloseFailed=true;this.#peerCloseFailure=error;throw error;}
  }
  /** @param {keyof typeof operations} kind @param {string} [invocationOriginal] */
  begin(kind, invocationOriginal) {
    if (this.#started) throw failure('IDE_IDENTITY_CALL_ALREADY_SELECTED');
    if (!Object.hasOwn(operations, kind) || (kind !== 'keyCall' && invocationOriginal !== undefined)) throw failure('IDE_IDENTITY_CALL_INVALID');
    this.#started = true; this.#kind = kind;
    return this.#enter(() => {
      // Store the SAME partial before any potentially failing late assertion.
      this.#constructing = true;
      try {
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
      } finally { this.#constructing = false; }
      if (this.#retired) this.retire(); // Late returned partial still needs its own retirement.
      this.#assertLive();
      const owner = this.#owner;
      successful(this.#native(() => owner.assertReady()));
      this.#assertLive();
      return undefined;
    });
  }
  request() {
    return this.#enter(() => {
      if (!this.#owner || !this.#kind || this.#proofSelected) throw failure('IDE_IDENTITY_REQUEST_UNAVAILABLE');
      const owner = this.#owner;
      successful(this.#native(() => owner.current()));
      this.#assertLive();
      const original = this.#native(() => owner.copyRequestOriginal());
      this.#assertLive();
      // Sole public SDK schema and E codec. No renderer-supplied expectedRaw,
      // clock, principal, Root or nonce is accepted as an argument here.
      const body = this.#contract.parseOriginalAuthIdentityRequest(original);
      if (body.purpose !== this.#contract.AUTH_IDENTITY_PURPOSES[operations[this.#kind][1]])
        throw failure('IDE_IDENTITY_PURPOSE_MISMATCH');
      const message = this.#contract.encodeOriginalAuthIdentityRequest(body);
      this.#assertLive();
      successful(this.#native(() => owner.current()));
      this.#assertLive();
      this.#requestPrepared = true;
      return Object.freeze({ original, message: new Uint8Array(message), dataOnly: true, authorized: false });
    });
  }
  /** @param {Uint8Array} memberWire */
  completeProof(memberWire) {
    return this.#enter(() => {
      if (!this.#owner || this.#proofSelected) throw failure('IDE_IDENTITY_PROOF_ALREADY_SELECTED');
      if (!this.#requestPrepared) throw failure('IDE_IDENTITY_REQUEST_UNAVAILABLE');
      if (!(memberWire instanceof Uint8Array) || !(memberWire.buffer instanceof ArrayBuffer))
        throw failure('IDE_IDENTITY_PROOF_BYTES_REQUIRED');
      const owner = this.#owner;
      successful(this.#native(() => owner.current()));
      this.#assertLive();
      // Selection precedes the genuine Native call even if it throws UNKNOWN.
      this.#proofSelected = true;
      successful(this.#native(() => owner.completeProof(new Uint8Array(memberWire))));
      this.#assertLive();
      successful(this.#native(() => owner.current()));
      this.#assertLive();
    });
  }
  result() {
    return this.#enter(() => {
      if (!this.#owner || !this.#proofSelected || (this.#kind === 'keyCall' && !this.#invokeSelected))
        throw failure('IDE_IDENTITY_RESULT_UNAVAILABLE');
      const owner = this.#owner;
      successful(this.#native(() => owner.current()));
      this.#assertLive();
      const result = this.#native(() => owner.result()); // backend-only unknown, no invented DTO
      this.#assertLive();
      successful(this.#native(() => owner.current()));
      this.#assertLive();
      return result;
    });
  }
  invoke() {
    return this.#enter(() => {
      if (!this.#owner || this.#kind !== 'keyCall' || !this.#proofSelected || this.#invokeSelected)
        throw failure('IDE_IDENTITY_INVOCATION_UNAVAILABLE');
      const owner = /** @type {import('@ynx-chain/wallet-auth/auth-native-contract').OriginalIDEProtectedKeyCallOwner} */ (this.#owner);
      successful(this.#native(() => owner.current()));
      this.#assertLive();
      this.#invokeSelected = true;
      const result = this.#native(() => owner.invoke()); // SAME captured call, zero arguments
      this.#assertLive();
      successful(this.#native(() => owner.current()));
      this.#assertLive();
      return result;
    });
  }
  retire() {
    this.#retired = true; // Immediately refuse late UI/proof callbacks.
    let peerFailed=false,peerFailure;
    try{this.#retirePeer();}catch(error){peerFailed=true;peerFailure=error;if(!this.#failed){this.#failed=true;this.#firstCause=error;}}
    if (this.#ownerRetireSelected) { if(peerFailed)throw peerFailure;if (this.#ownerRetireFailed) throw this.#ownerRetireFailure; return; }
    if (!this.#owner) {if(peerFailed)throw peerFailure;return;} // An entered constructor may still return a partial.
    this.#ownerRetireSelected = true;
    const owner = this.#owner;
    try { successful(this.#native(() => owner.retire())); }
    catch (error) {
      this.#ownerRetireFailed = true; this.#ownerRetireFailure = error;
      if (!this.#failed) { this.#failed = true; this.#firstCause = error; }
      if(peerFailed)throw peerFailure;
      throw error;
    }
    if(peerFailed)throw peerFailure;
  }
  join() {
    if (!this.#retired) throw failure('IDE_IDENTITY_RETIRE_REQUIRED');
    if (this.#constructing || this.#nativeDepth) throw failure('IDE_IDENTITY_JOIN_PENDING');
    if(this.#peerLoading&&!this.#peerClosed)throw failure('IDE_IDENTITY_PEER_CLOSE_REQUIRED');
    if (this.#joined) return;
    const owner = this.#owner;
    if (owner) successful(this.#native(() => owner.join())); // pending is retryable join, never business replay
    this.#joined = true;
  }
  close() {
    if (!this.#retired || !this.#joined) throw failure('IDE_IDENTITY_JOIN_REQUIRED');
    if (this.#nativeDepth) throw failure('IDE_IDENTITY_CLOSE_PENDING');
    if (this.#closeSelected) {
      if (this.#closeFailurePresent) throw this.#closeFailure;
      return;
    }
    this.#closeSelected = true;
    const owner = this.#owner;
    try { if (owner) successful(this.#native(() => owner.close())); this.#closed = true; }
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
    const owner = this.#owner;
    return (owner ? this.#native(() => owner.status()) : undefined) ?? Object.freeze({ phase: 'partial', ready: false,
      unknown: false, retired: this.#retired, cleanupComplete: this.#closed,
      disposed: this.#closed, firstCauseCode: this.#failed && typeof code === 'string' && /^[A-Z0-9_]{1,128}$/.test(code)
        ? code : this.#failed ? 'IDE_IDENTITY_CALL_FAILED' : null });
  }
}
