import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { p256 } from '@noble/curves/nist.js';
import { canonicalJSON } from '../vendor/wallet-auth-c5/src/canonical.js';
import { PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION } from '../vendor/wallet-auth-c5/src/product-session-gateway.js';
import { createProductSessionRequest, signProductSessionApproval, createProductSessionChallenge, signProductSessionChallengeWith } from '../vendor/wallet-auth-c5/src/product-session-v2.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp('/private/tmp/ynx-wallet-adapter-test-');
const registry = JSON.parse(await readFile(join(root,'vendor/wallet-auth-c5/product-session-registry.json'),'utf8'));
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
  globalThis.window=window;globalThis.fetch=async(url,options)=>{calls.fetch++;assert.equal(url,'https://wallet-auth.ynxweb4.com/v2/product-sessions/time');assert.equal(options.method,'GET');const requestId=options.headers['x-request-id'];return new Response(canonicalJSON({ok:true,requestId,result:{serverTime:'2026-10-06T00:00:00.000Z'},schemaVersion:PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION}),{headers:{'content-type':'application/json','x-request-id':requestId,'cache-control':'no-store'}});}; // Controlled clock response only; no external request.
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,get(){calls.indexedDB++;throw Error('V2 may never access the legacy IndexedDB signer');}});
  return {bridge,descriptor,calls,stored,window,async cleanup(runtime){await runtime?.endNativeOperation();globalThis.window=previousWindow;globalThis.fetch=previousFetch;if(previousIDB)Object.defineProperty(globalThis,'indexedDB',previousIDB);else delete globalThis.indexedDB;assert.equal(calls.indexedDB,0);}};
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
  let deviceReads=0;const f=fixture({device:async()=>{deviceReads++;throw Error('Connect explicitly to initialize native device');}});try {
    const info=await adapter.inspectDeveloperWalletV2Runtime();assert.equal(info.available,true);assert.equal(info.bridgeContract,'present');assert.equal(info.deviceStatus,'not-observed');assert.equal(info.authoritative,false);assert.equal(info.requiresExplicitConnection,true);assert.equal((await adapter.enterDeveloperWalletV2Guest()).available,true);assert.equal(deviceReads,0);assert.equal(f.calls.begin,0);assert.equal(f.calls.write,0);
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
    const pending=runtime.connection.beginYNX();for(let attempt=0;!finishRemove&&attempt<1000;attempt++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(typeof finishRemove,'function','SDK must reach protected cleanup');
    await runtime.endNativeOperation();finishRemove();
    // The SDK finishes its second cleanup call, which the frontend fence rejects
    // before it can reach the now-ended native capability.
    await assert.rejects(pending,/Explicit native/);assert.equal(f.calls.end,1);assert.equal(f.stored.get(base),'original-session');assert.equal(f.stored.has(`${base}:pending`),false);assert.equal(f.calls.open,0);
  }finally{await f.cleanup(runtime);}
});

test('authority time failure preserves protected evidence, releases consent and permits an explicit retry', async () => {
  const f=fixture();let runtime;
  const clock=globalThis.fetch;
  try {
    f.stored.set(base,'preserved-existing-state');
    f.stored.set(`${base}:pending`,'preserved-pending-evidence');
    globalThis.fetch=async()=>{throw Error('Controlled authority unavailable');};
    runtime=await adapter.beginDeveloperWalletV2Connection();
    const result=await runtime.connection.beginYNX();
    assert.notEqual(result.status,'wallet-opened');
    assert.equal(f.calls.open,0);assert.equal(f.calls.write,0);assert.equal(f.calls.end,1);
    assert.equal(f.stored.get(base),'preserved-existing-state');
    assert.equal(f.stored.get(`${base}:pending`),'preserved-pending-evidence');
    await assert.rejects(runtime.connection.beginYNX(),/Explicit native/);
    globalThis.fetch=clock;
    runtime=await adapter.beginDeveloperWalletV2Connection();
    const retried=await runtime.connection.beginYNX();
    assert.equal(retried.status,'wallet-opened');assert.equal(f.calls.open,1);
    assert.equal(f.stored.get(base),'preserved-existing-state');
  } finally { await f.cleanup(runtime); }
});

// Controlled storage port fixture only; native locking/Keychain guarantees are
// tested separately by the Objective-C fixture and eventual installed App QA.
function atomicPorts(f, { unknownOnce = false } = {}) {
  const seen={saved:[],finished:[],read:[]}, receipts=new Map();
  Object.assign(f.bridge.protectedStorage,{
    saveRevocationIntent:async(key,raw)=>{seen.saved.push([key,raw]);const old=f.stored.get(key);if(old)return old;f.stored.set(key,raw);return raw;},
    finishRevocationIntentWithCompletion:async(key,raw,receipt)=>{seen.finished.push([key,raw,receipt]);assert.equal(f.stored.get(key),raw);if(unknownOnce){unknownOnce=false;throw Error('UNKNOWN: controlled protected write result');}const intent=JSON.parse(raw);assert.equal(intent.session,null);for(const suffix of ['pending','return','completion','revoke'])f.stored.delete(`${base}:${suffix}`);receipts.set(intent.intentId,receipt);return receipt;},
    getRevocationCompletions:async()=>canonicalJSON([...receipts.values()].map(JSON.parse)),
    getRevocationCompletion:async(key,id)=>{seen.read.push([key,id]);return receipts.get(id)??null;},
    acknowledgeRevocationCompletion:async(key,raw)=>{const id=JSON.parse(raw).intentId;assert.equal(receipts.get(id),raw);receipts.delete(id);},
  });
  return seen;
}

test('real c5 pending-only disconnect forwards exact atomic intent and completion readback', async()=>{
  const f=fixture(),seen=atomicPorts(f);let runtime;
  try{
    runtime=await adapter.beginDeveloperWalletV2Connection();
    await runtime.connection.beginYNX();assert.ok(f.stored.has(`${base}:pending`));
    const result=await runtime.connection.disconnect();
    assert.equal(result.sessionState.status,'disconnected');
    assert.equal(result.sessionState.revocationConfirmed,false);
    assert.equal(result.sessionState.revocationCompletion.outcome,'local-only');
    assert.equal(seen.saved.length,1);assert.equal(seen.finished.length,1);
    assert.equal(seen.saved[0][0],`${base}:revoke`);
    assert.equal(seen.finished[0][1],seen.saved[0][1]);
    assert.equal(seen.read[0][0],`${base}:revoke-completions`);
    assert.equal(f.stored.has(`${base}:pending`),false);assert.equal(f.calls.end,1);
    await assert.rejects(runtime.connection.disconnect(),/Explicit native/);
    assert.equal(seen.finished.length,1,'ended capability cannot perform another write');
  }finally{await f.cleanup(runtime);}
});

test('UNKNOWN atomic finish retains the same intent for a fresh explicitly approved retry',async()=>{
  const f=fixture(),seen=atomicPorts(f,{unknownOnce:true});let runtime;
  try{
    runtime=await adapter.beginDeveloperWalletV2Connection();await runtime.connection.beginYNX();
    const failed=await runtime.connection.disconnect();
    assert.notEqual(failed.sessionState.status,'disconnected');
    const original=f.stored.get(`${base}:revoke`);assert.ok(original);assert.equal(f.calls.end,1);
    assert.ok(f.stored.has(`${base}:pending`));
    runtime=await adapter.beginDeveloperWalletV2Connection();
    const result=await runtime.connection.disconnect();
    assert.equal(result.sessionState.status,'disconnected');
    assert.equal(seen.finished.length,2);assert.equal(seen.finished[1][1],original);
    assert.equal(seen.finished[1][2],seen.finished[0][2]);assert.equal(f.calls.end,2);
  }finally{await f.cleanup(runtime);}
});

test('cold runtime reads retained receipts without restore, signing, network or acknowledgement',async()=>{
 const f=fixture();atomicPorts(f);let runtime;
 try {
  runtime=await adapter.beginDeveloperWalletV2Connection();
  const result=await runtime.connection.disconnect();const receipt=result.sessionState.revocationCompletion;
  const before={...f.calls};runtime=await adapter.createDeveloperWalletV2Runtime();
  assert.deepEqual(await runtime.connection.getRevocationCompletions(),[receipt]);
  assert.deepEqual(await runtime.connection.getRevocationCompletion(receipt.intentId),receipt);
  assert.equal(f.calls.fetch,before.fetch);assert.equal(f.calls.sign,before.sign);assert.equal(f.calls.write,before.write);
  await assert.rejects(runtime.connection.acknowledgeRevocationCompletion(receipt),/Explicit native/);
  runtime=await adapter.beginDeveloperWalletV2Connection();
  await assert.rejects(runtime.connection.acknowledgeRevocationCompletion(receipt),/durable Developer/);
  assert.deepEqual(await runtime.connection.getRevocationCompletion(receipt.intentId),receipt);
 }finally{await f.cleanup(runtime);}
});

test('acknowledgement requires successful exact durable journal readback before SDK removal',async()=>{
 const f=fixture();atomicPorts(f);let runtime;let saved=null,mode='fail';
 const journal={persist:async receipt=>{if(mode==='fail')throw Error('journal commit failed');saved=structuredClone(receipt);},read:async()=>mode==='mismatch'?null:saved};
 try{
  runtime=await adapter.beginDeveloperWalletV2Connection();const receipt=(await runtime.connection.disconnect()).sessionState.revocationCompletion;
  runtime=await adapter.beginDeveloperWalletV2Connection(journal);
  await assert.rejects(runtime.connection.acknowledgeRevocationCompletion(receipt),/journal commit failed/);
  assert.deepEqual(await runtime.connection.getRevocationCompletion(receipt.intentId),receipt);
  mode='mismatch';await assert.rejects(runtime.connection.acknowledgeRevocationCompletion(receipt),/exact durable/);
  assert.deepEqual(await runtime.connection.getRevocationCompletion(receipt.intentId),receipt);
  mode='ok';await runtime.connection.acknowledgeRevocationCompletion(receipt);
  assert.deepEqual(saved,receipt);assert.equal(await runtime.connection.getRevocationCompletion(receipt.intentId),null);
 }finally{await f.cleanup(runtime);}
});

test('native capability ending during journal commit cannot acknowledge retained receipt',async()=>{
 const f=fixture();atomicPorts(f);let runtime,finish;let saved;
 const journal={persist:receipt=>{saved=structuredClone(receipt);return new Promise(resolve=>{finish=resolve;});},read:async()=>saved};
 try{
  runtime=await adapter.beginDeveloperWalletV2Connection();const receipt=(await runtime.connection.disconnect()).sessionState.revocationCompletion;
  runtime=await adapter.beginDeveloperWalletV2Connection(journal);
  const ack=runtime.connection.acknowledgeRevocationCompletion(receipt);const rejected=assert.rejects(ack,/Explicit native/);
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  await runtime.endNativeOperation();finish();await rejected;
  assert.deepEqual(await runtime.connection.getRevocationCompletion(receipt.intentId),receipt);
 }finally{await f.cleanup(runtime);}
});

test('default connection consumes real native journal ports before acknowledgement; bad commit retains SDK receipt',async()=>{
 const f=fixture();atomicPorts(f);let runtime;const journal=new Map(),events=[];let bad=true;
 Object.assign(f.bridge.protectedStorage,{
  consumerJournalPersist:async raw=>{events.push('persist');if(bad)return '{}';journal.set(JSON.parse(raw).intentId,raw);return raw;},
  consumerJournalRead:async id=>{events.push('read');return journal.get(id)??null;},
 });
 const ack=f.bridge.protectedStorage.acknowledgeRevocationCompletion;
 f.bridge.protectedStorage.acknowledgeRevocationCompletion=async(...args)=>{events.push('ack');return ack(...args);};
 try {
  runtime=await adapter.beginDeveloperWalletV2Connection();const receipt=(await runtime.connection.disconnect()).sessionState.revocationCompletion;
  runtime=await adapter.beginDeveloperWalletV2Connection();
  await assert.rejects(runtime.connection.acknowledgeRevocationCompletion(receipt),/exact receipt/);
  assert.deepEqual(events,['persist']);assert.deepEqual(await runtime.connection.getRevocationCompletion(receipt.intentId),receipt);
  events.length=0;bad=false;await runtime.connection.acknowledgeRevocationCompletion(receipt);
  assert.deepEqual(events,['persist','read','ack']);assert.equal(journal.get(receipt.intentId),canonicalJSON(receipt));
  assert.equal(await runtime.connection.getRevocationCompletion(receipt.intentId),null);
 }finally{await f.cleanup(runtime);}
});
