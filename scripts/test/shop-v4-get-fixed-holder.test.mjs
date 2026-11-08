import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
const root=new URL('../../packages/wallet-auth/src/',import.meta.url);
const sole=await import(new URL('product-session-proof-v4.js',root));
const base64=await import(new URL('base64url.js',root));
const util=await import('node:util');
const {evmAddressFromYNX}=await import(new URL('crypto.js',root));
const account='ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80';
const unsigned={version:'4',sessionBinding:'11'.repeat(32),productId:'shop',clientId:'shop.desktop.macos',applicationId:'com.ynx.shop',bundleId:'com.ynx.shop',packageId:null,origin:'app://ynx-shop',callback:'ynxshop://wallet-auth/callback',account,canonicalOwner:evmAddressFromYNX(account),deviceId:'PUBLIC-device-0001',deviceRegistrationId:'PUBLIC-registration-0001',deviceRegistrationRevision:'9007199254740993',deviceRegistrationDigest:'22'.repeat(32),method:'GET',path:'/PUBLIC/order',bodyDigest:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',nonce:'N'.repeat(43),issuedAt:'2026-11-08T00:00:00.000Z',expiresAt:'2026-11-08T00:00:23.456Z'};
// Deliberately parse-only PUBLIC one-byte member. No signature or Root is modeled.
const header=sole.encodeProductSessionProofHeaderV4(unsigned,new Uint8Array([1]));
const suite='ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512';
async function fixture(){
 const state={owner:null,clients:[],closeCalls:0,proofErrorPresent:false,proofError:undefined,scopes:['PUBLIC:registered:read'],calls:[],proof:Object.freeze({version:'4',proofHeaderName:sole.PRODUCT_SESSION_PROOF_HEADER_V4,proofHeader:header,body:'',signatureVerified:true})};
 const ctx=createContext({console,Promise,Uint8Array,fetch(){},crypto:{getRandomValues(x){return x;}}});
 const synth=values=>new SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context:ctx});
 class WalletAuthError extends Error{constructor(code,message){super(message);this.code=code;}}
 class RecoverableProductSessionClient{constructor(config){this.config=config;state.clients.push(this);}async openExistingBusinessRead(){return Object.freeze({capabilities:Object.freeze({readOnly:true}),async createBusinessProof(input){state.calls.push(input);if(state.proofErrorPresent)throw state.proofError;return state.proof;},async close(){state.closeCalls++;}});}}
 const mocks={
 './pq-wallet-contract.js':{PQ_SUITE:suite},
 './original-auth-identity-fixed-native-image.js':{acquireOriginalProductSessionDeviceV4SourceStage(){return state.owner;}},
 './original-wallet-service-private-client.js':{hasOriginalWalletServicePrivateBridge:()=>false},
 './canonical.js':{WalletAuthError,exactFields(object,fields){assert.deepEqual(Object.keys(object).sort(),[...fields].sort());}},
 './base64url.js':base64,
 // PUBLIC VM boundary: adapt only the plain unsigned DATA prototype to the
 // outer sole codec realm; this is not a production IPC/opaque conversion.
 './product-session-proof-v4.js':{...sole,encodeProductSessionProofHeaderV4:(value,member)=>sole.encodeProductSessionProofHeaderV4(JSON.parse(JSON.stringify(value)),Uint8Array.from(member))},
 'node:util':util,
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
 state.owner={produceHTTPProof(){},readContext(){return {scopes:state.scopes};},readCurrent(){},readRegistrationOriginal(){},readSessionOriginal(){},assertCurrent(){if(currentErrorPresent)throw currentError;return currentReturn;},status(){return {retired,closed:false};},retire(){retired=true;},join(){},close(){}};
 const lease=stage.acquireOriginalProductSessionDeviceV4ReadLeaseStage();
 const signal={aborted:false};
 const config={registry:{},productId:'PUBLIC',platform:'desktop',storage:{},device:lease.device,deviceCurrent:lease.deviceCurrent,abortContext:{signal},gatewayTimeoutMs:100};
 const read=await factory.createProductWalletBusinessReadClient(config);
 return {state,stage,factory,publicFactory:publicFactory.namespace,publicStage:publicStage.namespace,lease,read,config,signal,createGET:top.namespace.createOriginalRegisteredClientGETProof,capture:top.namespace.captureOriginalRegisteredClientReadHolder,setReturn(value){currentReturn=value;},setExpired(error){currentErrorPresent=true;currentError=error;}};
}
let cases=0;
async function test(name,fn){if(process.argv[2]&&!name.startsWith(process.argv[2]))return;await fn();cases++;console.log('PASS',name);}
await test('actual lexical creator only accepts same private captured loan',async()=>{const f=await fixture();await assert.rejects(f.createGET({},unsigned.path));const loan=f.capture(f.read);await assert.rejects(f.createGET({...loan},unsigned.path));assert.equal(f.state.calls.length,0);loan.release();});
await test('sole decoder times are from exact original header without external TTL',async()=>{const f=await fixture();const loan=f.capture(f.read);const proof=await f.createGET(loan,unsigned.path);assert.equal(proof.proofHeader,header);assert.equal(proof.issuedAt,unsigned.issuedAt);assert.equal(proof.expiresAt,unsigned.expiresAt);assert.equal(proof.issuedAtMs,Date.parse(unsigned.issuedAt));assert.equal(proof.expiresAtMs-proof.issuedAtMs,23456);assert(Object.isFrozen(proof));assert.equal(f.state.calls[0].method,'GET');assert.equal(f.state.calls[0].body,'');assert.deepEqual([...f.state.calls[0].requiredScopes],f.state.scopes);loan.release();});
await test('foreign proof path poisons same loan without a replacement attempt',async()=>{const f=await fixture();const loan=f.capture(f.read);await assert.rejects(f.createGET(loan,'/PUBLIC/foreign'));assert.throws(()=>f.capture(f.read));assert.equal(f.state.calls.length,1);loan.release();});
await test('wrong version or header name is never interpreted as V4',async()=>{for(const change of [{version:'2'},{proofHeaderName:'x-v2'}]){const f=await fixture();f.state.proof={...f.state.proof,...change};const loan=f.capture(f.read);await assert.rejects(f.createGET(loan,unsigned.path));loan.release();}});
await test('canonical roundtrip rejects BOM carrier with same decoded unsigned',async()=>{const f=await fixture();const raw=Buffer.from(header,'base64url');f.state.proof={...f.state.proof,proofHeader:Buffer.concat([Buffer.from([239,187,191]),raw]).toString('base64url')};const loan=f.capture(f.read);await assert.rejects(f.createGET(loan,unsigned.path));loan.release();});
await test('proxy scope trap is never reflected',async()=>{const f=await fixture();let traps=0;f.state.scopes=new Proxy([],{ownKeys(){traps++;throw 0;},get(){traps++;throw 0;}});const loan=f.capture(f.read);await assert.rejects(f.createGET(loan,unsigned.path));assert.equal(traps,0);assert.equal(f.state.calls.length,0);loan.release();});
await test('released or retired holder cannot create GET but cleanup release still works',async()=>{for(const kind of ['release','retire']){const f=await fixture();const loan=f.capture(f.read);if(kind==='release')loan.release();else f.lease.retire();await assert.rejects(f.createGET(loan,unsigned.path));assert.equal(f.state.calls.length,0);loan.release();await f.read.close();}});
for(const error of [0,null,false,undefined])await test('paired original proof failure preserves '+String(error),async()=>{const f=await fixture();const loan=f.capture(f.read);f.state.proofErrorPresent=true;f.state.proofError=error;await assert.rejects(f.createGET(loan,unsigned.path),e=>e===error);loan.release();await f.read.close();});
await test('ONCE concurrent same loan same original path selects one actual proof flight',async()=>{const f=await fixture();const loan=f.capture(f.read);const a=f.createGET(loan,unsigned.path),b=f.createGET(loan,unsigned.path);assert.equal(a,b);const original=await a;assert.equal(await f.createGET(loan,unsigned.path),original);await assert.rejects(f.createGET(loan,'/PUBLIC/changed'));assert.equal(f.state.calls.length,1);loan.release();});
await test('ONCE UNKNOWN zero retains same rejection and never chooses another nonce',async()=>{const f=await fixture();const loan=f.capture(f.read);f.state.proofErrorPresent=true;f.state.proofError=0;const a=f.createGET(loan,unsigned.path);await assert.rejects(a,e=>e===0);const b=f.createGET(loan,unsigned.path);assert.equal(a,b);await assert.rejects(b,e=>e===0);assert.equal(f.state.calls.length,1);loan.release();});
await test('BOUNDED collector keeps original finite eight registered scopes before signing',async()=>{const f=await fixture();f.state.scopes=Array(9).fill('PUBLIC:read');const loan=f.capture(f.read);await assert.rejects(f.createGET(loan,unsigned.path));assert.equal(f.state.calls.length,0);loan.release();});
await test('ARITY Source comparison argument cannot be silently ignored by old capture',async()=>{const f=await fixture();assert.throws(()=>f.capture(f.read,{}),e=>e.message==='ORIGINAL_READ_CAPTURE_COMPARISON_NOT_SUPPLIED');assert.equal(f.factory.readOriginalProductWalletBusinessReadHolder(f.read).statusDATA().childReferences,0);const loan=f.capture(f.read);loan.release();});
console.log(JSON.stringify({cases,scopeComparisonSupplied:false,parseOnlyPublicMember:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false}));
