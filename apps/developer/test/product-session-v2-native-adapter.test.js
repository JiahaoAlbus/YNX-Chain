import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { p256 } from '@noble/curves/nist.js';
import { createProductSessionRequest, signProductSessionApproval, createProductSessionChallenge, signProductSessionChallengeWith } from '../vendor/wallet-auth/src/product-session-v2.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp('/private/tmp/ynx-wallet-adapter-test-');
const registry = JSON.parse(await readFile(join(root,'vendor/wallet-auth/product-session-registry.json'),'utf8'));
async function compile(name) {
  const result = await build({entryPoints:[join(root,`frontend/src/wallet/${name}.ts`)],bundle:true,platform:'node',format:'esm',write:false,
    plugins:[{name:'retained-sdk',setup(builder){builder.onResolve({filter:/vendor\/wallet-auth\/src\/index\.js$/},args=>({path:resolve(args.resolveDir,args.path),external:true}));}}]});
  const path = join(temporary,`${name}.mjs`);await writeFile(path,result.outputFiles[0].text);return import(pathToFileURL(path));
}
const transport=await compile('transport'), adapter=await compile('product-session-v2');
test.after(async()=>rm(temporary,{recursive:true,force:true}));
const base='ynx.product-session.v2:developer:macos:com.ynxweb4.developer.testnetpreview';
const encode=value=>Buffer.from(value).toString('base64url');
function fixture(overrides={}) {
  const calls={begin:0,end:0,device:0,sign:0,open:0,write:0,fetch:0,indexedDB:0}, stored=new Map();let active=false;
  // Synthetic adapter fixture only. Actual OS SecKey tests are separate.
  const secret=new Uint8Array(32).fill(9), descriptor={id:'ynx-developer-macos-device-v2',key:encode(p256.getPublicKey(secret,true)),algorithm:'p256-sha256',securityLevel:'os-protected',scopes:['account:read','developer:deploy'],purpose:'Connect YNX Developer to the approved testnet Developer account',
    sign:async input=>{calls.sign++;assert.ok(active);return encode(p256.sign(Buffer.from(input.payload,'base64url'),secret,{format:'der'}));}};
  const bridge={device:async()=>{calls.device++;return descriptor;},beginConnection:async()=>{calls.begin++;active=true;return descriptor;},endConnection:async()=>{calls.end++;active=false;},walletAvailability:async()=>({walletInstalled:true,schemeRegistered:true}),
    openAuthorization:async url=>{calls.open++;assert.ok(active);assert.match(url,/^ynxwallet:\/\/authorize\?request=/);bridge.opened=url;},
    protectedStorage:{securityLevel:'os-protected',get:async key=>stored.get(key)??null,set:async(key,value)=>{assert.ok(active);calls.write++;stored.set(key,value);},remove:async key=>{assert.ok(active);calls.write++;stored.delete(key);}},...overrides};
  const window=new EventTarget();window.ynxDesktopWallet=bridge;
  const previousWindow=globalThis.window, previousFetch=globalThis.fetch, previousIDB=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  globalThis.window=window;globalThis.fetch=async()=>{calls.fetch++;throw Error('No network permitted in adapter fixture');};
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,get(){calls.indexedDB++;throw Error('V2 may never access the legacy IndexedDB signer');}});
  return {bridge,descriptor,calls,stored,window,async cleanup(runtime){await runtime?.endNativeOperation();globalThis.window=previousWindow;globalThis.fetch=previousFetch;if(previousIDB)Object.defineProperty(globalThis,'indexedDB',previousIDB);else delete globalThis.indexedDB;assert.equal(calls.indexedDB,0);assert.equal(calls.fetch,0);}};
}

test('missing or legacy-only bridge makes V2 explicitly unavailable without a browser-key fallback',async()=>{
  const f=fixture();try {
    for(const bridge of [undefined,{openAuthorization:async()=>{},protectedStorage:f.bridge.protectedStorage}]){f.window.ynxDesktopWallet=bridge;assert.equal(await adapter.createDeveloperWalletV2Runtime(),null);assert.equal((await adapter.inspectDeveloperWalletV2Runtime()).available,false);const guest=await adapter.enterDeveloperWalletV2Guest();assert.equal(guest.available,true);assert.equal(guest.sessionState.status,'guest');assert.equal(guest.authoritative,false);assert.equal(guest.connectionMode,'local-guest');await assert.rejects(adapter.beginDeveloperWalletV2Connection(),/native OS-protected/);}
    assert.equal(f.calls.begin,0);assert.equal(f.calls.device,0);assert.equal(f.calls.write,0);
  }finally{await f.cleanup();}
});

test('inspection/options/SDK Guest are readonly; mutation and automatic restore require explicit consent',async()=>{
  const f=fixture();try {
    const runtime=await adapter.createDeveloperWalletV2Runtime();assert.ok(runtime);
    const info=await adapter.inspectDeveloperWalletV2Runtime();assert.equal(info.available,true);
    const guest=await adapter.enterDeveloperWalletV2Guest();assert.equal(guest.sessionState.status,'guest');assert.deepEqual(guest.sessionState.limitations,['not-signed-in','no-wallet-balance','no-transactions','no-chain-authority']);
    for(const method of ['beginYNX','restore','retryYNX','disconnect'])await assert.rejects(runtime.connection[method](),/Explicit native/);
    assert.equal(f.calls.begin,0);assert.equal(f.calls.end,0);assert.equal(f.calls.sign,0);assert.equal(f.calls.write,0);assert.equal(f.calls.open,0);
  }finally{await f.cleanup();}
});

test('first use with no native key cannot create one during inspection or Guest',async()=>{
  const f=fixture({device:async()=>{throw Error('Connect explicitly to initialize native device');}});try {
    const info=await adapter.inspectDeveloperWalletV2Runtime();assert.equal(info.available,false);assert.match(info.reason,/Connect explicitly/);assert.equal((await adapter.enterDeveloperWalletV2Guest()).available,true);assert.equal(f.calls.begin,0);assert.equal(f.calls.write,0);
  }finally{await f.cleanup();}
});

test('native descriptor identity/algorithm/scopes/purpose/security/key validation rejects widened capabilities',async()=>{
  const f=fixture();try {
    for(const patch of [{id:'foreign-device'},{algorithm:'secp256k1'},{securityLevel:'browser'},{purpose:'sign arbitrary payload'},{scopes:['account:read','wallet:sign']},{key:'A'.repeat(44)},{sign:undefined}]){f.bridge.device=async()=>({...f.descriptor,...patch});await assert.rejects(transport.developerWalletV2Device(),/Native Developer Wallet/);}
    assert.equal(f.calls.begin,0);assert.equal(f.calls.sign,0);
  }finally{await f.cleanup();}
});

test('actual retained SDK signs through the native adapter with exactly its original domain and public key',async()=>{
  const f=fixture();try {
    const granted=await f.bridge.beginConnection(), device=await transport.developerWalletV2Device(f.bridge,granted), at=new Date();
    const request=createProductSessionRequest(registry,{productId:'developer',platform:'macos',deviceId:device.id,deviceKey:device.key,scopes:device.scopes,purpose:device.purpose,nonce:encode(Buffer.alloc(32,1)),state:encode(Buffer.alloc(32,2))},at);
    const approval=signProductSessionApproval(registry,request,{accountSecret:'01'.repeat(32),scopes:request.scopes,expiresAt:request.expiresAt},at);
    const challenge=createProductSessionChallenge(registry,request,approval,{challenge:encode(Buffer.alloc(32,3))},at);
    const completion=await signProductSessionChallengeWith(challenge,device.sign);assert.equal(completion.challenge.deviceKey,f.descriptor.key);assert.equal(f.calls.sign,1);
    const input={purpose:'challenge',algorithm:'p256-sha256',deviceKey:device.key,payload:encode('YNX_WALLET_TRANSACTION_V2\n{}')};await assert.rejects(device.sign(input),/domain/);assert.equal(f.calls.sign,1);
    f.bridge.device=async()=>f.descriptor;f.window.ynxDesktopWallet={...f.bridge};await assert.rejects(device.sign({...input,payload:encode('YNX_PRODUCT_SESSION_CHALLENGE_V2\n{}')}),/bound to this native device/);
    await f.bridge.endConnection();
  }finally{await f.cleanup();}
});

test('cryptographically valid short DER is accepted by the retained noble verifier; malformed integers are rejected',async()=>{
  const f=fixture();try {
    // Public synthetic fixture with s=1, constructed for this exact payload.
    // No native/private key is exported. The SDK uses this same retained noble
    // strict-DER verifier for challenge signatures; its HTTP proof parser has
    // a separate known 68-byte floor that remains outside this adapter scope.
    const payload=Buffer.from('YNX_PRODUCT_SESSION_CHALLENGE_V2\n{}');
    const signature='MCUCIGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWAgEB';
    f.descriptor.key='AscTxIQcASLIIDvH8INLa09lLydJx-yFHV0JpNEg559L';
    f.descriptor.sign=async()=>signature;
    assert.equal(Buffer.from(signature,'base64url').length,39);
    assert.equal(p256.verify(Buffer.from(signature,'base64url'),payload,Buffer.from(f.descriptor.key,'base64url'),{format:'der',lowS:false}),true);
    const granted=await f.bridge.beginConnection(),device=await transport.developerWalletV2Device(f.bridge,granted);
    const input={purpose:'challenge',algorithm:'p256-sha256',deviceKey:device.key,payload:encode(payload)};
    assert.equal(await device.sign(input),signature);
    for(const hex of ['300702020001020101','3006020180020101','308106020101020101','3006020100020101','300602010102010100','3026022100ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551020101']){f.descriptor.sign=async()=>encode(Buffer.from(hex,'hex'));await assert.rejects(device.sign(input),/noncanonical DER/);}
    await f.bridge.endConnection();
  }finally{await f.cleanup();}
});

test('explicit Connect constructs the real SDK, opens its canonical request, and rejection ends capability/clears only pending',async()=>{
  const f=fixture();let runtime;try {
    runtime=await adapter.beginDeveloperWalletV2Connection();assert.equal(f.calls.begin,1);assert.equal(f.calls.open,0);assert.equal(f.calls.write,0);
    const state=await runtime.connection.beginYNX();assert.equal(state.status,'wallet-opened');assert.equal(f.calls.end,0);
    const request=JSON.parse(Buffer.from(new URL(f.bridge.opened).searchParams.get('request'),'base64url'));
    assert.equal(request.version,'2');assert.equal(request.deviceKey,f.descriptor.key);assert.equal(request.deviceId,f.descriptor.id);assert.equal(request.origin,'app://macos/com.ynxweb4.developer.testnetpreview');assert.equal(request.callback,'ynxdeveloper://wallet-auth/callback');assert.equal(request.clientId,'ynx-developer-v1');
    await assert.rejects(adapter.beginDeveloperWalletV2Connection(),/Finish the current/);assert.equal(f.calls.end,0);
    f.stored.set(base,'existing-session-evidence');
    const returned=await runtime.connection.handleReturn(`${request.callback}?${new URLSearchParams({result:'rejected',reason:'user_rejected',nonce:request.nonce,state:request.state})}`);
    assert.equal(returned.sessionState.status,'disconnected');assert.equal(f.calls.end,1);assert.equal(f.stored.has(`${base}:pending`),false);assert.equal(f.stored.get(base),'existing-session-evidence');
    await assert.rejects(runtime.connection.retryYNX(),/Explicit native/);
  }finally{await f.cleanup(runtime);}
});

test('native cancellation, invalid grant and failed Wallet opener release short authorization without erasing existing state',async()=>{
  const f=fixture();let runtime;try {
    f.stored.set(base,'original-v1-or-other-device-state');
    f.bridge.beginConnection=async()=>{f.calls.begin++;throw Error('Native user cancelled');};await assert.rejects(adapter.beginDeveloperWalletV2Connection(),/cancelled/);assert.equal(f.calls.end,1);
    f.bridge.beginConnection=async()=>{f.calls.begin++;return {...f.descriptor,purpose:'forged-purpose'};};await assert.rejects(adapter.beginDeveloperWalletV2Connection(),/capability is invalid/);assert.equal(f.calls.end,2);
    f.bridge.beginConnection=async()=>{f.calls.begin++;return f.descriptor;}; // replace with a fresh fixture below for native active-state fidelity
    assert.equal(f.stored.get(base),'original-v1-or-other-device-state');assert.equal(f.calls.write,0);
  }finally{await f.cleanup(runtime);}
  const failed=fixture({openAuthorization:async()=>{throw Error('Wallet did not open');}});try {
    runtime=await adapter.beginDeveloperWalletV2Connection();const result=await runtime.connection.beginYNX();assert.equal(result.status,'wallet-open-failed');assert.equal(failed.calls.end,1);assert.ok(failed.stored.has(`${base}:pending`),'SDK pending remains available to explicit retry');
  }finally{await failed.cleanup(runtime);}
});

test('concurrent native confirmations cannot cancel the owner; a device swap during approval fails closed',async()=>{
  const f=fixture();let runtime,answer;try {
    f.bridge.beginConnection=()=>{f.calls.begin++;return new Promise(resolve=>answer=resolve);};
    const pending=adapter.beginDeveloperWalletV2Connection();await assert.rejects(adapter.beginDeveloperWalletV2Connection(),/Finish the current/);assert.equal(f.calls.end,0);
    answer(f.descriptor);runtime=await pending;assert.equal(f.calls.begin,1);await runtime.endNativeOperation();assert.equal(f.calls.end,1);
    f.bridge.beginConnection=async()=>f.descriptor;f.bridge.device=async()=>({...f.descriptor,key:encode(p256.getPublicKey(new Uint8Array(32).fill(8),true))});
    await assert.rejects(adapter.beginDeveloperWalletV2Connection(),/changed during connection approval/);assert.equal(f.calls.end,2);assert.equal(f.calls.write,0);
  }finally{await f.cleanup(runtime);}
});

test('explicit cancellation fences a delayed SDK begin before it can write a new pending request',async()=>{
  const f=fixture();let runtime,finishRemove;try {
    runtime=await adapter.beginDeveloperWalletV2Connection();f.stored.set(base,'original-session');
    f.bridge.protectedStorage.remove=()=>new Promise(resolve=>finishRemove=resolve);
    const pending=runtime.connection.beginYNX();while(!finishRemove)await new Promise(resolve=>setImmediate(resolve));
    await runtime.endNativeOperation();finishRemove();
    // The SDK finishes its second cleanup call, which the frontend fence rejects
    // before it can reach the now-ended native capability.
    await assert.rejects(pending,/Explicit native/);assert.equal(f.calls.end,1);assert.equal(f.stored.get(base),'original-session');assert.equal(f.stored.has(`${base}:pending`),false);assert.equal(f.calls.open,0);
  }finally{await f.cleanup(runtime);}
});
