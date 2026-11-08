import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
const root=new URL('../../packages/wallet-auth/src/',import.meta.url);
const sole=await import(new URL('product-session-proof-v4.js',root));
const base64=await import(new URL('base64url.js',root));
const util=await import('node:util');
const {evmAddressFromYNX}=await import(new URL('crypto.js',root));
const account='ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80';
const unsigned={version:'4',sessionBinding:'11'.repeat(32),productId:'shop',clientId:'shop.desktop.macos',applicationId:'com.ynx.shop',bundleId:'com.ynx.shop',packageId:null,origin:'app://ynx-shop',callback:'ynxshop://wallet-auth/callback',account,canonicalOwner:evmAddressFromYNX(account),deviceId:'PUBLIC-device-0001',deviceRegistrationId:'PUBLIC-registration-0001',deviceRegistrationRevision:'9007199254740993',deviceRegistrationDigest:'22'.repeat(32),method:'GET',path:'/v5/shop/source/shop.order/invoice-intents/PUBLIC-order',bodyDigest:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',nonce:'N'.repeat(43),issuedAt:'2026-11-08T00:00:00.000Z',expiresAt:'2026-11-08T00:00:23.456Z'};
// Deliberately parse-only PUBLIC one-byte member. No signature or Root is modeled.
const header=sole.encodeProductSessionProofHeaderV4(unsigned,new Uint8Array([1]));
const scopeAPI=await import(new URL('../native/original-wallet-product-source-contract.mjs',root));
const publicBytes=await import(new URL('pq-public-bytes.js',root));
const hashUtils=await import(new URL('../node_modules/@noble/hashes/utils.js',root));
const scope={version:1,networkId:'33'.repeat(32),account:evmAddressFromYNX(account),protectedResourceRef:'PUBLIC-resource',operations:['readOriginalInvoiceIntent'],products:[{productId:'shop.order',sourceOrder:'PUBLIC-order'}]};
const suite='ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512';
async function fixture(){
 const state={owner:null,clients:[],closeCalls:0,proofErrorPresent:false,proofError:undefined,scopes:['PUBLIC:registered:read'],calls:[],referenceReads:0,reference:{purpose:'product-session-device-source-v4',sourceId:'PUBLIC-source',instanceId:'PUBLIC-instance',generation:17,accountIssuer:'https://wallet-auth.ynxweb4.com',accountSubject:account},proof:Object.freeze({version:'4',proofHeaderName:sole.PRODUCT_SESSION_PROOF_HEADER_V4,proofHeader:header,body:'',signatureVerified:true})};
 const ctx=createContext({console,Promise,Uint8Array,TextEncoder,fetch(){},crypto:{getRandomValues(x){return x;}}});
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
 '../native/original-wallet-product-source-contract.mjs':scopeAPI,
 './crypto.js':{evmAddressFromYNX},
 './pq-public-bytes.js':publicBytes,
 '@noble/hashes/utils.js':hashUtils,
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
 state.owner={readOriginalSourceReferenceDATA(){state.referenceReads++;return state.referenceFunction?state.referenceFunction(state.referenceReads):state.reference;},produceHTTPProof(){},readContext(){return {scopes:state.scopes,account,networkId:'33'.repeat(32),generation:'9007199254740993'};},readCurrent(){},readRegistrationOriginal(){},readSessionOriginal(){},assertCurrent(){if(currentErrorPresent)throw currentError;return currentReturn;},status(){return {retired,closed:false};},retire(){retired=true;},join(){},close(){}};
 const lease=stage.acquireOriginalProductSessionDeviceV4ReadLeaseStage();
 const signal={aborted:false};
 const config={registry:{},productId:'shop',platform:'desktop',storage:{},device:lease.device,deviceCurrent:lease.deviceCurrent,abortContext:{signal},gatewayTimeoutMs:100};
 const read=await factory.createProductWalletBusinessReadClient(config);
 return {state,stage,factory,publicFactory:publicFactory.namespace,publicStage:publicStage.namespace,lease,read,config,signal,forProduct:top.namespace.captureOriginalRegisteredClientReadHolderForProductSource,reference:top.namespace.readOriginalRegisteredClientSourceReferenceDATA,createGET:top.namespace.createOriginalRegisteredClientGETProof,capture:top.namespace.captureOriginalRegisteredClientReadHolder,setReturn(value){currentReturn=value;},setExpired(error){currentErrorPresent=true;currentError=error;}};
}
let cases=0;
async function check(name,fn){await fn();cases++;console.log('PASS',name);}
await check('actual same origin namespace getter returns immutable Source generation, not device generation',async()=>{const f=await fixture();const loan=f.capture(f.read);const ref=f.reference(loan);assert.equal(ref.generation,17);assert.equal(typeof ref.generation,'number');assert(Object.isFrozen(ref));assert.equal(f.state.referenceReads,2);loan.release();});
await check('fixed zeroarg opaque getter is exact original Native object and not namespace DATA',async()=>{const f=await fixture();const loan=f.capture(f.read);assert.equal(loan.readOriginalNativeDeviceSource(),f.state.owner);assert.throws(()=>loan.readOriginalNativeDeviceSource({}));assert.equal(loan.statusDATA().NativeAdmission,false);assert.equal('sameEngine' in loan.statusDATA(),false);loan.release();assert.throws(()=>loan.readOriginalNativeDeviceSource());});
await check('optional Native capability missing does not retire original old read',async()=>{const f=await fixture();delete f.state.owner.readOriginalSourceReferenceDATA;const loan=f.capture(f.read);assert.throws(()=>f.reference(loan),e=>e.message==='PRODUCT_DEVICE_V4_SOURCE_REFERENCE_NOT_SUPPLIED');loan.assertCurrent();await loan.createBusinessProof('PUBLIC-existing-read');assert.equal(f.state.calls.length,1);loan.release();});
await check('scope6 and namespace only DATA match; fixed creator alone reaches selected Shop order',async()=>{const f=await fixture();const loan=f.forProduct(f.read,scope);assert.equal('createBusinessProof' in loan,false);await assert.rejects(f.createGET(loan,'/v5/shop/source/shop.order/invoice-intents/FOREIGN-order'));assert.equal(f.state.calls.length,0);const result=await f.createGET(loan,unsigned.path);assert.equal(result.proofHeader,header);assert.equal(f.state.calls.length,1);assert.equal(loan.readOriginalNativeDeviceSource(),f.state.owner);assert.equal(loan.statusDATA().SourceAdmission,false);loan.release();});
await check('scope canonical owner/network/op/Cloud union mismatch refuses and drops childref',async()=>{for(const change of [{account:'0x'+'44'.repeat(20)},{networkId:'44'.repeat(32)},{operations:['readInvoice']},{products:[{productId:'cloud.ide-usage',sourceOrder:'PUBLIC-order'}]}]){const f=await fixture();assert.throws(()=>f.forProduct(f.read,{...scope,...change}));assert.equal(f.factory.readOriginalProductWalletBusinessReadHolder(f.read).statusDATA().childReferences,0);assert.equal(f.state.calls.length,0);}});
await check('namespace foreign subject or issuer is not accepted as Source account',async()=>{for(const change of [{accountSubject:'FOREIGN-subject'},{accountIssuer:'https://foreign.invalid'}]){const f=await fixture();f.state.reference={...f.state.reference,...change};assert.throws(()=>f.forProduct(f.read,scope));assert.equal(f.factory.readOriginalProductWalletBusinessReadHolder(f.read).statusDATA().childReferences,0);}});
await check('namespace snapshot is stable across real fixed getter reads',async()=>{const f=await fixture();f.state.referenceFunction=n=>({...f.state.reference,generation:17+n});const loan=f.capture(f.read);assert.throws(()=>f.reference(loan),e=>e.message==='ORIGINAL_DEVICE_SOURCE_REFERENCE_CHANGED');loan.release();});
await check('namespace closed fields/safe generation/UTF8 limits enforced without coercion',async()=>{for(const change of [{generation:'17'},{generation:Number.MAX_SAFE_INTEGER+1},{sourceId:'a'.repeat(513)},{sourceId:'bad\0id'},{extra:true}]){const f=await fixture();f.state.reference={...f.state.reference,...change};const loan=f.capture(f.read);assert.throws(()=>f.reference(loan));loan.release();}});
await check('proxy/getter traps are not invoked by namespace or scope collectors',async()=>{const f=await fixture();let traps=0;f.state.reference=new Proxy({},{ownKeys(){traps++;throw 0;},get(){traps++;throw 0;}});const loan=f.capture(f.read);assert.throws(()=>f.reference(loan));assert.equal(traps,0);loan.release();const g=await fixture();const dto={...scope};Object.defineProperty(dto,'account',{get(){traps++;throw 0;},enumerable:true});assert.throws(()=>g.forProduct(g.read,dto));assert.equal(traps,0);});
await check('zero current first-cause remains zero; cleanup is still allowed',async()=>{const f=await fixture();const loan=f.capture(f.read);f.setExpired(0);let caught=false;try{loan.readOriginalNativeDeviceSource();}catch(e){caught=true;assert.equal(e,0);}assert(caught);loan.release();await f.read.close();});
await check('sole shape extraction grants no time and full inspector preserves exact expiry boundary',()=>{const shape=scopeAPI.inspectOriginalWalletProductScopeShapeV1DATA(scope,scope.networkId,scope.account);assert.equal(shape.authorized,false);assert.equal('effectExpiresAtMs' in shape,false);const live=scopeAPI.inspectOriginalWalletProductScopeV1DATA(scope,scope.networkId,scope.account,100,200,199);assert.equal(live.effectExpiresAtMs,200);assert.throws(()=>scopeAPI.inspectOriginalWalletProductScopeV1DATA(scope,scope.networkId,scope.account,100,200,200));assert.throws(()=>scopeAPI.inspectOriginalWalletProductScopeV1DATA(scope,scope.networkId,scope.account,200,100,150));});
await check('caller scope mutations cannot alter captured selected order',async()=>{const f=await fixture();const input=structuredClone(scope),loan=f.forProduct(f.read,input);input.products[0].sourceOrder='FOREIGN-order';input.operations.length=0;const result=await f.createGET(loan,unsigned.path);assert.equal(result.proofHeader,header);loan.release();});
console.log(JSON.stringify({cases,modelOnly:true,actualNativeSourceObjectModel:true,nativeProductDeviceCurrentMatcherSupplied:false,NativeSlotEnabled:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false}));
