import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
const root=new URL('../../packages/wallet-auth/src/',import.meta.url);
const suite='ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512';
async function fixture(){
 const state={owner:null,clients:[],closeCalls:0,proofErrorPresent:false,proofError:undefined};
 const ctx=createContext({console,Promise,Uint8Array,fetch(){},crypto:{getRandomValues(x){return x;}}});
 const synth=values=>new SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context:ctx});
 class WalletAuthError extends Error{constructor(code,message){super(message);this.code=code;}}
 class RecoverableProductSessionClient{constructor(config){this.config=config;state.clients.push(this);}async openExistingBusinessRead(){return Object.freeze({capabilities:Object.freeze({readOnly:true}),async createBusinessProof(input){if(state.proofErrorPresent)throw state.proofError;return input;},async close(){state.closeCalls++;}});}}
 const mocks={
 './pq-wallet-contract.js':{PQ_SUITE:suite},
 './original-auth-identity-fixed-native-image.js':{acquireOriginalProductSessionDeviceV4SourceStage(){return state.owner;}},
 './original-wallet-service-private-client.js':{hasOriginalWalletServicePrivateBridge:()=>false},
 './canonical.js':{WalletAuthError,exactFields(object,fields){assert.deepEqual(Object.keys(object).sort(),[...fields].sort());}},
 './base64url.js':{encodeBase64url:()=>'',decodeBase64url(){throw Error('UNUSED_GET_CODEC_IN_ORIGINAL_HOLDER_MODEL');}},
 // Only import-shape maintenance: these old holder cases never call fixed GET.
 './product-session-proof-v4.js':{decodeProductSessionProofHeaderV4(){throw Error('UNUSED_GET_CODEC_IN_ORIGINAL_HOLDER_MODEL');},encodeProductSessionProofHeaderV4(){throw Error('UNUSED_GET_CODEC_IN_ORIGINAL_HOLDER_MODEL');},PRODUCT_SESSION_PROOF_HEADER_V4:'x-ynx-product-session-proof-v4'},
 'node:util':{types:{isProxy(){throw Error('UNUSED_GET_CONTEXT_IN_ORIGINAL_HOLDER_MODEL');}}},
 './product-session-gateway-client.js':{ProductSessionGatewayFetchAdapter:class{},ProductSessionGatewayPrivateAdapter:class{}},
 './product-session-recovery.js':{RecoverableProductSessionClient},
 './wallet-connection-coordinator.js':{WalletConnectionCoordinator:class{}}
 };
 const modules=new Map();
 async function load(name){if(modules.has(name))return modules.get(name);let m;if(mocks[name])m=synth(mocks[name]);else m=new SourceTextModule(await readFile(new URL(name.slice(2),root),'utf8'),{context:ctx,identifier:name});modules.set(name,m);await m.link(load);return m;}
 const top=await load('./original-shop-registered-client-holder-private.js');await top.evaluate();
 const stage=modules.get('./original-product-device-v4-source-stage-private.js').namespace;
 const factory=modules.get('./product-wallet-connection-holder-private.js').namespace;
 const publicFactory=await load('./product-wallet-connection.js');await publicFactory.evaluate();const publicStage=await load('./original-product-device-v4-source-stage.js');await publicStage.evaluate();
 let retired=false,currentErrorPresent=false,currentError,currentReturn;
 state.owner={produceHTTPProof(){},readContext(){},readCurrent(){},readRegistrationOriginal(){},readSessionOriginal(){},assertCurrent(){if(currentErrorPresent)throw currentError;return currentReturn;},status(){return {retired,closed:false};},retire(){retired=true;},join(){},close(){}};
 const lease=stage.acquireOriginalProductSessionDeviceV4ReadLeaseStage();
 const signal={aborted:false};
 const config={registry:{},productId:'PUBLIC',platform:'desktop',storage:{},device:lease.device,deviceCurrent:lease.deviceCurrent,abortContext:{signal},gatewayTimeoutMs:100};
 const read=await factory.createProductWalletBusinessReadClient(config);
 return {state,stage,factory,publicFactory:publicFactory.namespace,publicStage:publicStage.namespace,lease,read,config,signal,capture:top.namespace.captureOriginalRegisteredClientReadHolder,setReturn(value){currentReturn=value;},setExpired(error){currentErrorPresent=true;currentError=error;}};
}
let count=0;
async function test(name,fn){if(process.argv[2]&&!name.startsWith(process.argv[2]))return;await fn();count++;console.log('PASS',name);}
await test('fake and cloned read do not enter normal inventory',async()=>{const f=await fixture();assert.throws(()=>f.capture({}));assert.throws(()=>f.capture({...f.read}));});
await test('public constructor alone does not enter normal factory inventory',async()=>{const f=await fixture();assert.throws(()=>f.capture(f.state.clients[0]));});
await test('cloned and foreign device views fail provenance AND',async()=>{const f=await fixture();assert.throws(()=>f.stage.readOriginalProductSessionDeviceV4ReadOrigin({...f.lease.device},f.lease.deviceCurrent));assert.throws(()=>f.stage.readOriginalProductSessionDeviceV4ReadOrigin(f.lease.device,{}));});
await test('same genuine PUBLIC boundary owner delegates only existing read child',async()=>{const f=await fixture();const loan=f.capture(f.read);assert.equal(await loan.createBusinessProof('PUBLIC-GET'),'PUBLIC-GET');assert.equal(f.state.clients.length,1);loan.release();assert.throws(()=>loan.assertCurrent());});
await test('Native current expired preserves raw zero',async()=>{const f=await fixture();f.setExpired(0);let caught=false;try{f.capture(f.read);}catch(error){caught=true;assert.equal(error,0);}assert(caught);});
await test('retired Native owner refuses new loan',async()=>{const f=await fixture();f.lease.retire();assert.throws(()=>f.capture(f.read));});
await test('close waits same child reference and has unique promise',async()=>{const f=await fixture();const loan=f.capture(f.read);const a=f.read.close(),b=f.read.close();assert.equal(a,b);await Promise.resolve();assert.equal(f.state.closeCalls,0);assert.throws(()=>loan.assertCurrent());loan.release();loan.release();await a;assert.equal(f.state.closeCalls,1);assert.throws(()=>f.capture(f.read));});
await test('aborted original context refuses borrow but permits release cleanup',async()=>{const f=await fixture();const loan=f.capture(f.read);f.signal.aborted=true;assert.throws(()=>loan.assertCurrent());loan.release();await f.read.close();assert.equal(f.state.closeCalls,1);});
for(const error of [0,null,false,undefined])await test('UNKNOWN failed loan preserves first presence '+String(error),async()=>{const f=await fixture();const loan=f.capture(f.read);f.state.proofErrorPresent=true;f.state.proofError=error;await assert.rejects(loan.createBusinessProof('GET'),e=>e===error);let caught=false;try{f.capture(f.read);}catch(e){caught=true;assert.equal(e,error);}assert(caught);loan.release();await f.read.close();assert.equal(f.state.closeCalls,1);});
await test('DELTA public entries retain only original exports',async()=>{const f=await fixture();assert.deepEqual(Object.keys(f.publicFactory).sort(),['PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN','createProductWalletBusinessReadClient','createProductWalletConnection','createProductWalletReturnPublisher'].sort());assert.deepEqual(Object.keys(f.publicStage).sort(),['acquireOriginalProductSessionDeviceV4ReadLeaseStage','acquireOriginalProductSessionDeviceV4SourceStage'].sort());});
await test('DELTA returned falsy Native current refuses and preserves raw value',async()=>{for(const value of [0,false,null]){const f=await fixture();f.setReturn(value);let caught=false;try{f.capture(f.read);}catch(error){caught=true;assert.equal(error,value);}assert(caught);}});
await test('DELTA close selection invalidates provenance before physical close',async()=>{const f=await fixture();f.lease.close();assert.throws(()=>f.capture(f.read));});
await test('LATE release after dispatch cannot reborrow or sign another attempt',async()=>{const f=await fixture();const loan=f.capture(f.read);const work=loan.createBusinessProof('GET');loan.release();await assert.rejects(work);assert.throws(()=>f.capture(f.read));await f.read.close();});
console.log(JSON.stringify({cases:count,modelOnly:true,NativeAdmission:false,SourceAdmission:false,RootAdmission:false}));
