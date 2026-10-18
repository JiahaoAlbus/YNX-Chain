import {assertOriginalPrivatePQCarrier} from './original-wallet-service-private-pq-budget.js';
import { createHash, randomUUID } from "node:crypto";
import {types} from 'node:util';
import {createServer} from 'node:http';
import {CanonicalWalletGatewayNodeHost} from './gateway-node-host.js';
import {GatewayAdmissionController,forwardedClient} from './gateway-admission.js';
import {
  chmodSync, closeSync, constants, fchmodSync, fsyncSync, fstatSync, lstatSync,
  mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { decodeProductSessionGatewayProofHeaderV2, PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2 } from "./product-session-gateway-client.js";
import { ProductSessionGatewayHttpHandler } from "./product-session-gateway-http.js";
import { PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION } from "./product-session-gateway.js";
import { parseProductSessionRegistry } from "./product-session-registry.js";
import { WALLET_SESSION_CONTROL_PATHS, WALLET_SESSION_CONTROL_PROOF_HEADER, walletSessionControlClockFloor } from "./wallet-session-control.js";
import {createCentralBrowserSessionRegistry} from './central-browser-session-registry.js';
import {CentralBrowserSessionStore} from './central-browser-session-store.js';
import {CentralBrowserSessionAuthority,CentralBrowserSessionNodeRoutes} from './central-browser-session.js';
import {OriginalHostTerminalJournal} from './original-host-terminal-journal.js';
import {handleOriginalAuthSourceCurrent} from './original-auth-identity-source-current.js';

export const PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION = 1;
// Actual same-process Host inventory, not registration or readiness authority.
// No structural callback/DTO can enter this inventory.
const originalRuntimeHostSources = new WeakMap();
// Local transaction custody only. Not a Native-purpose/terminal authority.
const originalPrivateTransactions = new WeakMap();
function privateData(value,fields,strict=true){
  if(!value||typeof value!=='object'||types.isProxy(value))fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Original data is unavailable');
  const ds=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(ds).some(k=>typeof k!=='string')||(strict&&Object.keys(ds).sort().join('|')!==[...fields].sort().join('|')))fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Original fields differ');
  const out={};for(const k of fields){const d=ds[k];if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Accessor is not original data');out[k]=d.value;}
  return out;
}
function privateInput(value){
  if(!value||typeof value!=='object'||types.isProxy(value))fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Original data is unavailable');
  const v=privateData(value,['requestId','operation','phase','body','proofHeader',...(Object.hasOwn(value??{},'carrierVersion')?['carrierVersion']:[])]);
  const budget=assertOriginalPrivatePQCarrier(v);
  if(!validRequestId(v.requestId)||!['beginYNX','handleReturn','restore','disconnect'].includes(v.operation)||!['time','effect'].includes(v.phase)
    ||!(v.body===null||typeof v.body==='string')||!(v.proofHeader===null||typeof v.proofHeader==='string')||Buffer.byteLength(canonicalJSON(v))>budget.envelope)fail('ORIGINAL_PRIVATE_REQUEST_INVALID','Invalid original input');
  return Object.freeze(v);
}
function privateAssociation(value){
  const v=privateData(value,['account','clientId','productId','platform','applicationId','deviceId'],false);
  if(Object.values(v).some(x=>typeof x!=='string'||x.length===0||Buffer.byteLength(x)>4096))fail('ORIGINAL_PRIVATE_ASSOCIATION_NOT_SUPPLIED','Original association unavailable');
  return Object.freeze(v);
}
function privateResultRaw(value){
  const v=privateData(value,['status','headers','body']);
  if(!Number.isInteger(v.status)||v.status<100||v.status>599||typeof v.body!=='string'||Buffer.byteLength(v.body)>1048576||!v.headers||typeof v.headers!=='object'||types.isProxy(v.headers))fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Invalid original result');
  const ds=Object.getOwnPropertyDescriptors(v.headers),headers={};if(Reflect.ownKeys(ds).some(k=>typeof k!=='string')||Object.keys(ds).length>128)fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Invalid result headers');
  for(const [k,d]of Object.entries(ds)){if(!d.enumerable||!Object.hasOwn(d,'value')||typeof d.value!=='string')fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Result accessor is not data');headers[k]=d.value;}
  return canonicalJSON({status:v.status,headers,body:v.body});
}
export function captureOriginalWalletServiceRuntimeHostSource(source) {
  const owned = originalRuntimeHostSources.get(source);
  if (!owned) fail('ORIGINAL_RUNTIME_NOT_CONFIGURED', 'Original Host source is unavailable');
  owned.assertCurrent();
  return owned.view;
}
const STATE_FIELDS = ["schemaVersion", "snapshotDigest", "snapshot"];
const TIME_ROUTE = "/v2/product-sessions/time";
const WALLET_ORIGIN = "https://wallet.ynxweb4.com";
const RETURN_BASE = '/v2/product-sessions/returns';
const RETURN_ROUTES = new Set([RETURN_BASE,...['challenge','complete','outcome'].map(x=>RETURN_BASE+'/'+x)]);
const ROUTES = new Set([
  ...RETURN_ROUTES,
  TIME_ROUTE,
  ...WALLET_SESSION_CONTROL_PATHS,
  "/v2/product-sessions/challenge",
  "/v2/product-sessions/complete",
  "/v2/product-sessions/introspect",
  "/v2/product-sessions/revoke",
  "/v2/product-sessions/devices/revoke",
]);
const CORS_ALLOWED_HEADERS = "content-type, x-request-id, x-ynx-product-session-proof-v2";
const WALLET_CORS_ALLOWED_HEADERS = `content-type, x-request-id, ${WALLET_SESSION_CONTROL_PROOF_HEADER}`;
const MAX_STATE_BYTES = 32 * 1024 * 1024;

export class ProductSessionGatewayNodeHost {
  #handler; #now; #origins; #registry; #stateIdentity; #statePath; #tokens; #central; #originalRuntimeHandler;
  #originalRuntimeListener; #originalRuntimeServer;
  #privateTransactions=new Map(); #privateActive=null; #privateFailurePresent=false; #privateFirstCause;
  #privateTerminalJournal; #privateTerminalOriginal; #privateRetainedOwners=new WeakMap();
  #authSourceCurrent=null;
  #accountPolicy=null;

  #requiredAccountContext(context){
    if(!this.#accountPolicy){if(context!==null)fail('ACCOUNT_POLICY_MODE_REQUIRED','Account context requires the normal service policy mode');return null;}
    if(context===null)fail('ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED','Original request-local policy observation is required');
    const value=privateData(context,['observation','verifiedApproval','required']);
    if(value.required!==true||value.observation==null)fail('ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED','Original request-local policy observation is required');
    return Object.freeze(value);
  }
  #newHandler(snapshot,context=null){
    const selected=context??(this.#accountPolicy?{observation:null,verifiedApproval:null,required:true}:null);
    return new ProductSessionGatewayHttpHandler(this.#registry,this.#tokens,snapshot,undefined,selected);
  }
  #retainHandlerSnapshot(candidate){
    // Keep durable state, never one user's borrowed capability on the Host.
    this.#handler=this.#newHandler(candidate.snapshot());
  }
  async #withAccountPolicy(operation,execute){
    if(!this.#accountPolicy)return execute(null);
    let active=true,entered=false,result,firstPresent=false,firstCause;
    const run=context=>{
      try{
        if(!active||entered)fail('ACCOUNT_POLICY_EXECUTION_ALREADY_ENTERED','Original policy continuation cannot replay');
        entered=true;result=execute(this.#requiredAccountContext(context));return undefined;
      }catch(cause){if(!firstPresent){firstPresent=true;firstCause=cause;}throw cause;}
    };
    let returned;
    try{returned=await this.#accountPolicy.run(Object.freeze(operation),run);}finally{active=false;}
    if(firstPresent)throw firstCause; // A supplier cannot suppress an execution refusal.
    if(!entered||result===undefined)fail('ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED','Normal policy runner did not execute the original transaction');
    if(returned!==undefined)fail('ACCOUNT_POLICY_RUNNER_INVALID','Normal policy runner cannot substitute a result');
    return result;
  }

  reserveOriginalWalletServicePrivateTransaction(input,retained,association){
    if(this.#privateFailurePresent)throw this.#privateFirstCause;
    if(this.#privateActive!==null)fail('ORIGINAL_PRIVATE_REENTRY','Original transaction is active');
    const captured=privateInput(input),bound=privateAssociation(association);
    if(!retained||types.isProxy(retained))fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Original retained slot unavailable');
    const slot=Object.getOwnPropertyDescriptor(retained,'result');if(!slot||!Object.hasOwn(slot,'value')||slot.writable!==true||slot.value!==null)fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Result slot already used');
    if(this.#privateRetainedOwners.has(retained))fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Original retained slot already selected');
    const key=captured.operation+':'+captured.phase+':'+captured.requestId;
    if(this.#privateTransactions.has(key))fail('ORIGINAL_PRIVATE_ALREADY_ENTERED','Original intent already selected');
    if(this.#privateTransactions.size>=64)fail('ORIGINAL_PRIVATE_CAPACITY','Original transaction capacity');
    this.#assertStateIdentity();
    const owner=Object.freeze({}),record={host:this,owner,key,input:captured,inputRaw:canonicalJSON(captured),association:bound,associationRaw:canonicalJSON(bound),retained,result:null,resultRaw:null,entered:false,completed:false,unknown:false,firstPresent:false,firstCause:undefined,closed:false,before:null,after:null};
    originalPrivateTransactions.set(owner,record);this.#privateTransactions.set(key,owner);this.#privateRetainedOwners.set(retained,owner);return owner;
  }
  #privateOwned(owner){const r=originalPrivateTransactions.get(owner);if(!r||r.host!==this||this.#privateTransactions.get(r.key)!==owner)fail('ORIGINAL_PRIVATE_TRANSACTION_OWNER_REQUIRED','Original Host owner required');return r;}
  #privateFail(record,cause){if(!record.firstPresent){record.firstPresent=true;record.firstCause=cause;}record.unknown=true;if(!this.#privateFailurePresent){this.#privateFailurePresent=true;this.#privateFirstCause=cause;}return record.firstCause;}
  markOriginalWalletServicePrivateTransactionUnknown(owner,cause){const r=this.#privateOwned(owner);this.#privateFail(r,cause);return undefined;}
  #privateCaptureResult(record,result){
    record.result=result; // Capture before validation/persistence can fail.
    const slot=Object.getOwnPropertyDescriptor(record.retained,'result');if(!slot||!Object.hasOwn(slot,'value')||slot.writable!==true)fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Original retained slot changed');
    record.retained.result=result;record.resultRaw=privateResultRaw(result);
  }
  executeOriginalWalletServicePrivateTransaction(owner,accountContext=null){
    const r=this.#privateOwned(owner);if(r.closed||r.entered)fail('ORIGINAL_PRIVATE_ALREADY_ENTERED','Original transaction cannot replay');
    const context=r.input.phase==='time'?null:this.#requiredAccountContext(accountContext);
    if(this.#privateFailurePresent)throw this.#privateFirstCause;
    if(this.#privateActive!==null)fail('ORIGINAL_PRIVATE_REENTRY','Original transaction active');
    r.entered=true;r.unknown=true;this.#privateActive=owner;
    try{
      this.#assertStateIdentity();r.before=Object.freeze({...this.#stateIdentity});
      if(!this.#privateTerminalJournal||!this.#privateTerminalOriginal)fail('HOST_DIRFD_ORIGINAL_OWNER_REQUIRED','Original Native terminal owner is absent');
      r.terminalClaim=this.#privateTerminalJournal.reserve(r.input,r.association,r.before.digest);
      const result=this.#executeOriginalWalletServicePrivateRequest(r.input,r.retained,r.association,r,context);
      this.#assertStateIdentity();
      if(snapshotDigest(this.#handler.snapshot())!==this.#stateIdentity.digest)fail('STATE_TAMPERED','Original kernel readback differs');
      r.after=Object.freeze({...this.#stateIdentity});
      this.#privateTerminalJournal.commit(r.terminalClaim,result,r.after.digest);
      this.#privateTerminalJournal.assertTerminal(r.terminalClaim,result);
      r.completed=true;r.unknown=false;
      this.assertOriginalWalletServicePrivateTransactionReadback(owner,r.input,result);return result;
    }catch(cause){throw this.#privateFail(r,cause);}finally{this.#privateActive=null;}
  }
  async executeOriginalWalletServicePrivateTransactionWithPolicy(owner){
    const r=this.#privateOwned(owner);
    if(r.input.phase==='time')return this.executeOriginalWalletServicePrivateTransaction(owner);
    const paths={beginYNX:'/v2/product-sessions/challenge',handleReturn:'/v2/product-sessions/complete',restore:'/v2/product-sessions/introspect',disconnect:'/v2/product-sessions/revoke'};
    const proof=r.input.proofHeader===null?null:decodeProductSessionGatewayProofHeaderV2(r.input.proofHeader);
    const session=proof===null?null:this.#handler.snapshot().authority.sessions.find(value=>value.sessionBinding===proof.sessionBinding)??null;
    return this.#withAccountPolicy({requestId:r.input.requestId,method:'POST',path:paths[r.input.operation],body:r.input.body,proofHeader:r.input.proofHeader,walletControlProofHeader:null,session,at:this.#now().toISOString()},context=>this.executeOriginalWalletServicePrivateTransaction(owner,context));
  }
  assertOriginalWalletServicePrivateTransactionReadback(owner,input,result){
    const r=this.#privateOwned(owner);
    if(r.closed||!r.entered||!r.completed||r.unknown)throw r.firstPresent?r.firstCause:new WalletAuthError('ORIGINAL_PRIVATE_TRANSACTION_UNRESOLVED','Original local transaction unresolved');
    try{
      if(canonicalJSON(privateInput(input))!==r.inputRaw||result!==r.result||privateResultRaw(result)!==r.resultRaw)fail('ORIGINAL_PRIVATE_TRANSACTION_MISMATCH','Original local readback mismatch');
      const slot=Object.getOwnPropertyDescriptor(r.retained,'result');if(!slot||!Object.hasOwn(slot,'value')||slot.value!==r.result)fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Original retained result changed');
      this.#assertStateIdentity();
      if(!r.after||Object.keys(r.after).some(k=>r.after[k]!==this.#stateIdentity[k])||snapshotDigest(this.#handler.snapshot())!==r.after.digest)fail('STATE_TAMPERED','Original transaction state no longer current');
      return undefined; // LOCAL owning readback only; never Native terminal ACK.
    }catch(cause){throw this.#privateFail(r,cause);}
  }
  originalWalletServicePrivateTransactionOutcome(owner){const r=this.#privateOwned(owner);return Object.freeze({result:r.result,entered:r.entered,completed:r.completed,unknown:r.unknown,firstCausePresent:r.firstPresent,firstCause:r.firstCause,closed:r.closed,nativeTerminal:false});}
  closeOriginalWalletServicePrivateTransaction(owner){const r=this.#privateOwned(owner);if(this.#privateActive===owner)fail('ORIGINAL_PRIVATE_TRANSACTION_INFLIGHT','Original transaction is active');r.closed=true;return undefined;}

  // Additive to R9 transaction custody: this is called once by the original
  // factory after admission, never a public provider/DTO grant installer.
  bindOriginalWalletServicePrivateTerminal(original){
    if(this.#privateTerminalJournal||this.#privateTransactions.size)fail('HOST_DIRFD_ALREADY_SELECTED','Original journal cannot be rebound');
    this.#privateTerminalOriginal=original;
    this.#privateTerminalJournal=new OriginalHostTerminalJournal(this.#statePath,original);
    this.#privateTerminalJournal.open(); // retain partial before readiness
    return undefined;
  }
  assertOriginalWalletServicePrivateTerminal(input,retained,resultDigest,association){
    const owner=this.#privateRetainedOwners.get(retained),r=this.#privateOwned(owner);
    try{
      this.assertOriginalWalletServicePrivateTransactionReadback(owner,input,r.result);
      if(canonicalJSON(privateAssociation(association))!==r.associationRaw||typeof resultDigest!=='string'||!/^[a-f0-9]{64}$/.test(resultDigest)||createHash('sha256').update(privateResultRaw(r.result)).digest('hex')!==resultDigest||!r.terminalClaim||!this.#privateTerminalJournal)fail('ORIGINAL_PRIVATE_TERMINAL_INVALID','Original durable result binding differs');
      this.#privateTerminalJournal.assertTerminal(r.terminalClaim,r.result);
      this.assertOriginalWalletServicePrivateTransactionReadback(owner,input,r.result);
      return undefined;
    }catch(cause){throw this.#privateFail(r,cause);}
  }
  retireOriginalWalletServicePrivateTerminal(){return this.#privateTerminalJournal?.retire();}
  joinOriginalWalletServicePrivateTerminal(){return this.#privateTerminalJournal?.join();}
  closeOriginalWalletServicePrivateTerminal(){return this.#privateTerminalJournal?.close();}

  constructor(registryInput, options) {
    exactFields(options,["now","statePath","tokenFactory",...(Object.hasOwn(options,'centralBrowser')?["centralBrowser"]:[]),...(Object.hasOwn(options,'centralBackend')?["centralBackend"]:[]),...(Object.hasOwn(options,'centralOIDC')?["centralOIDC"]:[]),...(Object.hasOwn(options,'businessRevalidation')?["businessRevalidation"]:[]),...(Object.hasOwn(options,'centralBrowserEcosystem')?["centralBrowserEcosystem"]:[]),...(Object.hasOwn(options,'privateBusinessRevalidation')?["privateBusinessRevalidation"]:[]),...(Object.hasOwn(options,'privateBackendRegistrations')?["privateBackendRegistrations"]:[]),...(Object.hasOwn(options,'authIdentitySourceCurrent')?['authIdentitySourceCurrent']:[]),...(Object.hasOwn(options,'accountPolicy')?['accountPolicy']:[])],"Product Session Gateway Node host options");
    this.#authSourceCurrent=options.authIdentitySourceCurrent??null;
    if(Object.hasOwn(options,'accountPolicy')){
      const config=privateData(options.accountPolicy,['mode','run']);
      if(config.mode!=='required'||typeof config.run!=='function')fail('ACCOUNT_POLICY_CONFIG_INVALID','Normal account policy configuration is invalid');
      this.#accountPolicy=Object.freeze(config);
    }
    if(Object.hasOwn(options,'centralBackend')){if(options.centralBrowser!==true)fail("INVALID_HOST","Confidential clients require explicit central adoption");exactFields(options.centralBackend,["backendClients","familySealKey"],"Confidential client host dependencies");}
    if(Object.hasOwn(options,'centralOIDC')&&options.centralBrowser!==true)fail('INVALID_HOST','OIDC requires explicit Central adoption');
    if(Object.hasOwn(options,'centralBrowser')&&typeof options.centralBrowser!=='boolean')fail('INVALID_HOST','Central browser adoption must be explicit');
    for(const key of ['businessRevalidation','centralBrowserEcosystem','privateBusinessRevalidation'])if(Object.hasOwn(options,key)&&(typeof options[key]!=='boolean'||options.centralBrowser!==true))fail('INVALID_HOST','Business adoption must be explicit');
    if(Object.hasOwn(options,'privateBackendRegistrations')&&options.privateBusinessRevalidation!==true)fail('INVALID_HOST','Private registration requires explicit private business adoption');
    if (typeof options.now !== "function" || typeof options.tokenFactory !== "function") fail("INVALID_HOST", "Product Session Gateway Node host dependencies are invalid");
    if (typeof options.statePath !== "string" || !isAbsolute(options.statePath) || options.statePath === "/") fail("INVALID_STATE_PATH", "Product Session Gateway state path must be an absolute file path");
    this.#registry = parseProductSessionRegistry(registryInput);
    this.#origins = new Set(this.#registry.products.map((product) => product.webOrigin));
    this.#now = options.now; this.#tokens = options.tokenFactory; this.#statePath = options.statePath;
    const stored = loadState(this.#statePath);
    this.#handler = this.#newHandler(stored?.snapshot);
    if (stored === null) this.#persist(this.#handler.snapshot());
    else this.#stateIdentity = stored.identity;
    if(options.centralBrowser)this.#central=new CentralBrowserSessionNodeRoutes(new CentralBrowserSessionAuthority(createCentralBrowserSessionRegistry(this.#registry,{ecosystem:options.centralBrowserEcosystem===true}),new CentralBrowserSessionStore(`${this.#statePath}.browser`),{now:()=>this.#now().getTime(),tokenFactory:this.#tokens,...(options.centralBackend??{}),oidc:options.centralOIDC??null,businessRevalidation:options.businessRevalidation===true,privateBusinessRevalidation:options.privateBusinessRevalidation===true,privateProductRegistry:this.#registry,privateBackendRegistrations:options.privateBackendRegistrations??[],productRevalidator:(session,scopes,productId,at)=>this.revalidate(session,scopes,productId,at,options.businessRevalidation===true||options.privateBusinessRevalidation===true)}));
  }

  revalidate(session,scopes,productId,at,businessRevalidation=false,accountContext=null){this.#assertStateIdentity();const handler=this.#accountPolicy?this.#newHandler(this.#handler.snapshot(),this.#requiredAccountContext(accountContext)):this.#handler;const result=handler.revalidate(session,scopes,productId,this.#accountPolicy?this.#now():at,businessRevalidation);this.#assertStateIdentity();return result;}

  // Fixed private caller uses the SAME kernel/state transaction as HTTP.
  // Caller must already hold an independently recognized Native association;
  // this method does not create one from request fields or a result record.
  handleOriginalWalletServicePrivateRequest(input,retained,association,accountContext=null){
    const owner=this.reserveOriginalWalletServicePrivateTransaction(input,retained,association);
    return this.executeOriginalWalletServicePrivateTransaction(owner,accountContext);
  }
  #executeOriginalWalletServicePrivateRequest(input,retained,association,record,accountContext){
    assertOriginalPrivatePQCarrier(input);
    const paths={beginYNX:'/v2/product-sessions/challenge',handleReturn:'/v2/product-sessions/complete',restore:'/v2/product-sessions/introspect',disconnect:'/v2/product-sessions/revoke'};
    if(!Object.hasOwn(paths,input.operation)||!['time','effect'].includes(input.phase)||!validRequestId(input.requestId))fail('ORIGINAL_PRIVATE_REQUEST_INVALID','Original private operation is invalid');
    const descriptor=Object.getOwnPropertyDescriptor(retained??{},'result');
    if(!descriptor||!Object.hasOwn(descriptor,'value')||descriptor.writable!==true)fail('ORIGINAL_PRIVATE_CUSTODY_INVALID','Retained result slot is absent');
    this.#assertStateIdentity();
    const boundFields=['account','clientId','productId','platform','applicationId','deviceId'];
    if(!association||boundFields.some(field=>typeof association[field]!=='string'||association[field].length===0))fail('ORIGINAL_PRIVATE_ASSOCIATION_NOT_SUPPLIED','Original Native association is absent');
    if(input.phase==='time'){
      if(input.body!==null||input.proofHeader!==null)fail('ORIGINAL_PRIVATE_REQUEST_INVALID','Clock phase has no effect payload');
      const now=this.#now();if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail('INVALID_TIME','Product Session authority time is unavailable');
      if(now.getTime()<walletSessionControlClockFloor(this.#handler.snapshot()))fail('CLOCK_UNAVAILABLE','Product Session authority clock moved behind its durable history');
      const result=Object.freeze({status:200,headers:Object.freeze({'cache-control':'no-store','content-type':'application/json; charset=utf-8','x-request-id':input.requestId}),body:canonicalJSON({ok:true,requestId:input.requestId,result:{serverTime:now.toISOString()},schemaVersion:PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION})});
      this.#privateCaptureResult(record,result);this.#assertStateIdentity();return result;
    }
    if(input.operation==='restore'||input.operation==='disconnect'){
      const proof=decodeProductSessionGatewayProofHeaderV2(input.proofHeader);
      const session=this.#handler.snapshot().authority.sessions.find(value=>value.sessionBinding===proof.sessionBinding);
      if(!session||boundFields.some(field=>session[field]!==association[field]))fail('CROSS_PRODUCT_SESSION','Original private association differs from owned session');
      this.#newHandler(this.#handler.snapshot(),accountContext).revalidate(session,[],session.productId,this.#now(),true);
    }else{
      let body;try{body=JSON.parse(input.body);}catch{fail('INVALID_BODY','Original private body is invalid');}
      if(body.approval?.account!==association.account||boundFields.filter(field=>field!=='account').some(field=>body.request?.[field]!==association[field]))fail('CROSS_PRODUCT_SESSION','Original private approval differs from Native association');
    }
    const candidate=this.#newHandler(this.#handler.snapshot(),accountContext);
    const result=candidate.handle({requestId:input.requestId,method:'POST',path:paths[input.operation],contentType:'application/json',body:input.body,proofHeader:input.proofHeader,networkAvailable:true},this.#now());
    this.#privateCaptureResult(record,result); // Original before late persistence.
    const before=snapshotDigest(this.#handler.snapshot()),after=snapshotDigest(candidate.snapshot());
    if(after!==before)this.#persist(candidate.snapshot());
    this.#retainHandlerSnapshot(candidate);this.#assertStateIdentity();return result;
  }

  // This original Host constructs its own real daemon listener and Server.
  // No caller-supplied handler registration/allowlist can acquire its brand.
  createOriginalWalletServiceRuntimeDaemonServer({legacyHost,central,admission,emitEvent}) {
    this.#assertStateIdentity();
    if(this.#originalRuntimeServer)fail('ORIGINAL_RUNTIME_ALREADY_CREATED','Original daemon Server already exists');
    const legacyHandler=CanonicalWalletGatewayNodeHost.prototype.handler.call(legacyHost);
    const productHandler=this.#createHandler();
    if(typeof emitEvent!=='function')fail('INVALID_HOST','Original event sink is absent');
    const dispatch=async(request,response)=>{
      const path=new URL(request.url,'http://127.0.0.1').pathname;
      // The real v2 daemon uses THIS listener, not gatewayd's v3 pre-router.
      // Forward only the fixed Source-current route into the owning handler.
      if(path==='/v1/auth-identity/source-current')return productHandler(request,response);
      if(central&&CentralBrowserSessionNodeRoutes.prototype.handles.call(central,path)){
        if(this.#accountPolicy)fail('ACCOUNT_POLICY_CENTRAL_CONTEXT_NOT_SUPPLIED','Central authority has no original request-local policy transaction');
        let body='';if(request.method==='POST'){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>16384)throw new Error('Central browser body exceeds policy');chunks.push(chunk);}body=Buffer.concat(chunks).toString('utf8');}
        const result=CentralBrowserSessionNodeRoutes.prototype.handle.call(central,{method:request.method,url:request.url,headers:request.headers,body});response.writeHead(result.status,result.headers);response.end(result.body);return;
      }
      if(this.#accountPolicy&&!request.url?.startsWith('/v2/product-sessions/'))fail('ACCOUNT_POLICY_LEGACY_ROUTE_NOT_SUPPORTED','Legacy daemon authority cannot bypass required account policy');
      return request.url?.startsWith('/v2/product-sessions/')?productHandler(request,response):legacyHandler(request,response);
    };
    const listener=(request,response)=>{
      const ticket=GatewayAdmissionController.prototype.enter.call(admission,forwardedClient(request));
      if(!ticket.ok){response.writeHead(ticket.status,{'cache-control':'no-store','content-type':'application/json; charset=utf-8','retry-after':'60'});response.end(canonicalJSON({error:{code:ticket.code,message:'Wallet Gateway admission policy rejected the request'},ok:false}));return;}
      response.once('finish',ticket.release);response.once('close',ticket.release);
      Promise.resolve(dispatch(request,response)).catch(error=>{ticket.release();if(!response.headersSent){response.writeHead(500,{'cache-control':'no-store','content-type':'application/json; charset=utf-8'});response.end(canonicalJSON({error:{code:'INTERNAL_ERROR',message:'Wallet Gateway request failed'},ok:false}));}emitEvent({at:new Date().toISOString(),error:error instanceof Error?error.message:'unknown',event:'handler_error',level:'error',service:'ynx-wallet-gatewayd'});});
    };
    const server=createServer(listener);
    this.#originalRuntimeListener=listener;this.#originalRuntimeServer=server;
    return server;
  }

  captureOriginalWalletServiceRuntimeSource() {
    this.#assertStateIdentity();
    const registryRaw = canonicalJSON(this.#registry);
    const view = Object.freeze({handler:this.#originalRuntimeListener??this.#originalRuntimeHandler??this.#createHandler(),server:this.#originalRuntimeServer??null,registryRaw,registryDigest:createHash('sha256').update(registryRaw).digest('hex')});
    const source = Object.freeze({});
    originalRuntimeHostSources.set(source,{view,assertCurrent:()=>{
      this.#assertStateIdentity();
      if (canonicalJSON(this.#registry)!==registryRaw||(this.#originalRuntimeListener??this.#originalRuntimeHandler)!==view.handler||(this.#originalRuntimeServer??null)!==view.server) fail('ORIGINAL_RUNTIME_SOURCE_CHANGED','Original Host registry or handler changed');
    }});
    return source;
  }

  handler() {return this.#createHandler();}
  #createHandler() {
    const handler=async (request, response) => {
      const requestId = validRequestId(request.headers["x-request-id"]) ? request.headers["x-request-id"] : "req_invalid_request_000";
      let corsHeaders = {};
      try {
        this.#assertStateIdentity();
        if(new URL(request.url,'http://127.0.0.1').pathname==='/v1/auth-identity/source-current'){
          if(!this.#authSourceCurrent){response.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});response.end('{"error":"AUTH_SOURCE_CURRENT_SERVICE_NOT_CONFIGURED"}');return;}
          // This existing original producer handler owns the private branding
          // check; neither a marker nor a public arithmetic kernel can mount.
          const result=handleOriginalAuthSourceCurrent(this.#authSourceCurrent,request.method,request.url,this.#now().getTime());
          response.writeHead(result.status,result.headers);response.end(result.body);return;
        }
        const browserPath=this.#central?new URL(request.url,'http://127.0.0.1').pathname:null;
        const route=this.#central?.handles(browserPath)?browserPath:pathname(request.url);
        if(this.#central?.handles(route)){
          if(this.#accountPolicy)fail('ACCOUNT_POLICY_CENTRAL_CONTEXT_NOT_SUPPLIED','Central authority has no original request-local policy transaction');
          const body=request.method==='POST'?await boundedBody(request):'';
          const result=this.#central.handle({method:request.method,url:request.url,headers:request.headers,body});
          response.writeHead(result.status,result.headers);response.end(result.body);return;
        }
        corsHeaders = this.#corsHeaders(request.headers.origin, route);
        if (request.method === "OPTIONS") {
          const method = this.#preflight(request, corsHeaders);
          response.writeHead(204, { ...corsHeaders, "access-control-allow-headers": allowedHeaders(route), "access-control-allow-methods": method, "access-control-max-age": "300", "cache-control": "no-store" });
          response.end(); return;
        }
        if (!ROUTES.has(route)) fail("ROUTE_NOT_FOUND", "Product Session Gateway route is not registered");
        if (route === TIME_ROUTE) {
          if (request.method !== "GET") fail("METHOD_NOT_ALLOWED", "Product Session Gateway time accepts GET only");
          if (!validRequestId(request.headers["x-request-id"])) fail("INVALID_REQUEST_ID", "Product Session Gateway time requires a valid request ID");
          const now = this.#now();
          if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("INVALID_TIME", "Product Session Gateway time is unavailable");
          const lastSeen = walletSessionControlClockFloor(this.#handler.snapshot());
          if (now.getTime() < lastSeen) fail("CLOCK_UNAVAILABLE", "Product Session authority clock moved behind its durable history");
          // Clock reads never enter the authority kernel or alter its durable audit/state.
          response.writeHead(200, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId, ...corsHeaders });
          response.end(canonicalJSON({ ok: true, requestId, result: { serverTime: now.toISOString() }, schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION }));
          return;
        }
        if (request.method !== "POST") fail("METHOD_NOT_ALLOWED", "Product Session Gateway accepts POST only");
        const body = await boundedBody(request);
        this.#assertStateIdentity();
        const proofHeader = nullableHeader(request.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2]);
        const walletControlProofHeader = nullableHeader(request.headers[WALLET_SESSION_CONTROL_PROOF_HEADER]);
        this.#assertOriginBinding(request.headers.origin, route, body, proofHeader);
        const result=await this.#executePolicyRequest({requestId,route,body,proofHeader,walletControlProofHeader,contentType:singleHeader(request.headers["content-type"])});
        response.writeHead(result.status, { ...result.headers, ...corsHeaders }); response.end(result.body);
      } catch (caught) {
        const error = hostError(caught);
        response.writeHead(error.status, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId, ...corsHeaders });
        response.end(canonicalJSON({ error: { code: error.code, message: error.message }, ok: false, requestId, schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION }));
      }
    };
    this.#originalRuntimeHandler=handler;
    return handler;
  }

  async #executePolicyRequest({requestId,route,body,proofHeader=null,walletControlProofHeader=null,contentType='application/json'}){
    this.#assertStateIdentity();
    const referenceRoute=RETURN_ROUTES.has(route),originalDigest=snapshotDigest(this.#handler.snapshot());
    const proof=proofHeader===null?null:decodeProductSessionGatewayProofHeaderV2(proofHeader);
    let session=proof===null?null:this.#handler.snapshot().authority.sessions.find(value=>value.sessionBinding===proof.sessionBinding)??null,publication;
    if(referenceRoute){
      if(!this.#accountPolicy)fail('ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED','Reference returns require the original normal policy service');
      let input;try{input=JSON.parse(body);}catch{fail('INVALID_BODY','Reference body is invalid');}
      publication=route===RETURN_BASE?null:this.#handler.returnPublication(input.reference);
      session=route===RETURN_BASE?null:this.#handler.returnPublicationSession(input.reference);
    }
    return this.#withAccountPolicy({requestId,method:'POST',path:route,body,proofHeader,walletControlProofHeader,session,at:this.#now().toISOString(),...(referenceRoute?{publication}:{})},accountContext=>{
      this.#assertStateIdentity();
      // A Source borrow cannot resume against a changed durable publication.
      if(referenceRoute&&snapshotDigest(this.#handler.snapshot())!==originalDigest)fail('ACCOUNT_POLICY_OPERATION_CHANGED','Original publication changed while acquiring Source');
      const candidate=this.#newHandler(this.#handler.snapshot(),accountContext);
      const result=candidate.handle({requestId,method:'POST',path:route,contentType,body,proofHeader,walletControlProofHeader,networkAvailable:true},this.#now());
      const before=snapshotDigest(this.#handler.snapshot()),after=snapshotDigest(candidate.snapshot());
      if(after!==before)this.#persist(candidate.snapshot());
      this.#retainHandlerSnapshot(candidate);this.#assertStateIdentity();return result;
    });
  }
  // Main-only entry points share the HTTP transaction and its single snapshot.
  #referenceInput(input,fields){privateData(input,fields);if(!validRequestId(input.requestId))fail('INVALID_REQUEST_ID','Original return requires a request ID');}
  async publishOriginalProductSessionReturn(input){
    this.#referenceInput(input,['requestId','request','approval']);
    return this.#executePolicyRequest({requestId:input.requestId,route:RETURN_BASE,body:canonicalJSON({request:input.request,approval:input.approval})});
  }
  async readOriginalProductSessionReturnChallenge(input){
    this.#referenceInput(input,['requestId','reference','request']);
    return this.#executePolicyRequest({requestId:input.requestId,route:RETURN_BASE+'/challenge',body:canonicalJSON({reference:input.reference,request:input.request})});
  }
  async completeOriginalProductSessionReturn(input){
    this.#referenceInput(input,['requestId','reference','request','completion']);
    return this.#executePolicyRequest({requestId:input.requestId,route:RETURN_BASE+'/complete',body:canonicalJSON({reference:input.reference,request:input.request,completion:input.completion})});
  }
  async readOriginalProductSessionReturnCompletionOutcome(input){
    this.#referenceInput(input,['requestId','reference','request','completion']);
    return this.#executePolicyRequest({requestId:input.requestId,route:RETURN_BASE+'/outcome',body:canonicalJSON({reference:input.reference,request:input.request,completion:input.completion})});
  }
  // Owning caller recovery after publish ACK loss: metadata, never a grant.
  readOriginalProductSessionReturnOutcome(requestId){
    if(!validRequestId(requestId))fail('INVALID_REQUEST_ID','Original return requires a request ID');
    this.#assertStateIdentity();return this.#handler.readOriginalReturnPublicationOutcome(requestId);
  }

  snapshot() { return this.#handler.snapshot(); }

  #corsHeaders(value, route) {
    if (value === undefined) return {};
    const origin = canonicalOrigin(value);
    const allowed = WALLET_SESSION_CONTROL_PATHS.includes(route) ? origin === WALLET_ORIGIN : this.#origins.has(origin) || route === TIME_ROUTE && origin === WALLET_ORIGIN;
    if (!allowed) fail("ORIGIN_NOT_ALLOWED", "Product Session Gateway origin is not registered for this route");
    return { "access-control-allow-origin": origin, "access-control-expose-headers": "x-request-id", vary: "origin" };
  }

  #assertOriginBinding(origin, route, body, proofHeader) {
    if (origin === undefined) return; // Native clients and server proxies do not send a browser Origin.
    if (WALLET_SESSION_CONTROL_PATHS.includes(route)) return; // The Wallet-only origin policy was already checked; the owning account signature grants authority.
    let boundOrigin;
    if (RETURN_ROUTES.has(route) || route === "/v2/product-sessions/challenge" || route === "/v2/product-sessions/complete") {
      let input; try { input = JSON.parse(body); } catch { fail("INVALID_BODY", "Product Session Gateway body is not JSON"); }
      boundOrigin = input?.request?.origin;
    } else {
      if (proofHeader === null) return; // The protocol handler reports PROOF_REQUIRED.
      boundOrigin = decodeProductSessionGatewayProofHeaderV2(proofHeader).origin;
    }
    if (boundOrigin !== origin) fail("ORIGIN_NOT_ALLOWED", "Product Session Gateway browser origin does not match the session binding");
  }

  #preflight(request, corsHeaders) {
    if (Object.keys(corsHeaders).length === 0) fail("ORIGIN_NOT_ALLOWED", "Product Session Gateway preflight requires a registered origin");
    const route = pathname(request.url);
    if (!ROUTES.has(route)) fail("ROUTE_NOT_FOUND", "Product Session Gateway route is not registered");
    const method = route === TIME_ROUTE ? "GET" : "POST";
    if (request.headers["access-control-request-method"] !== method) fail("METHOD_NOT_ALLOWED", `Product Session Gateway preflight requires ${method}`);
    const supplied = singleHeader(request.headers["access-control-request-headers"]);
    const headers = supplied.split(",").map((item) => item.trim().toLowerCase());
    const allowed = new Set(allowedHeaders(route).split(", "));
    if (headers.length === 0 || new Set(headers).size !== headers.length || headers.some((item) => !allowed.has(item))) fail("INVALID_CORS_REQUEST", "Product Session Gateway requested headers are not allowed");
    return method;
  }

  #assertStateIdentity() {
    const loaded = loadState(this.#statePath), identity = loaded?.identity;
    if (!identity || !this.#stateIdentity || identity.dev !== this.#stateIdentity.dev || identity.ino !== this.#stateIdentity.ino || identity.size !== this.#stateIdentity.size || identity.digest !== this.#stateIdentity.digest) fail("STATE_TAMPERED", "Product Session Gateway state identity changed outside the process");
  }

  #persist(snapshot) {
    if (this.#stateIdentity) this.#assertStateIdentity();
    const envelope = { schemaVersion: PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION, snapshotDigest: snapshotDigest(snapshot), snapshot };
    const encoded = canonicalJSON(envelope);
    if (Buffer.byteLength(encoded) > MAX_STATE_BYTES) fail("STATE_CAPACITY", "Product Session Gateway state exceeds policy");
    const directory = dirname(this.#statePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o077) !== 0 || !ownedByProcess(directoryStat)) fail("STATE_PERMISSIONS", "Product Session Gateway state directory must be an owner-bound real mode-0700 directory");
    const temporary = `${this.#statePath}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor, renamed = false;
    try {
      descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow(), 0o600);
      writeFileSync(descriptor, encoded, { encoding: "utf8" }); fchmodSync(descriptor, 0o600); fsyncSync(descriptor);
      const stat = fstatSync(descriptor); if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || !ownedByProcess(stat)) fail("STATE_PERMISSIONS", "Product Session Gateway temporary state is unsafe");
      closeSync(descriptor); descriptor = undefined;
      renameSync(temporary, this.#statePath); renamed = true; chmodSync(this.#statePath, 0o600);
      const directoryDescriptor = openSync(directory, constants.O_RDONLY); try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
      const loaded = loadState(this.#statePath);
      if (!loaded || loaded.snapshotDigest !== envelope.snapshotDigest) fail("STATE_TAMPERED", "Product Session Gateway persisted state did not read back exactly");
      this.#stateIdentity = loaded.identity;
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (!renamed) { try { unlinkSync(temporary); } catch (caught) { if (caught?.code !== "ENOENT") throw caught; } }
      throw error;
    }
  }
}

function loadState(path) {
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | noFollow()); }
  catch (caught) { if (caught?.code === "ENOENT") return null; if (caught?.code === "ELOOP") fail("STATE_PERMISSIONS", "Product Session Gateway state must not be a symbolic link"); throw caught; }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > MAX_STATE_BYTES || !ownedByProcess(stat)) fail("STATE_PERMISSIONS", "Product Session Gateway state must be one owner-bound mode-0600 regular file");
    const raw = readFileSync(descriptor, "utf8"); let envelope;
    try { envelope = JSON.parse(raw); } catch { fail("STATE_TAMPERED", "Product Session Gateway state is invalid JSON"); }
    exactFields(envelope, STATE_FIELDS, "Product Session Gateway persisted state");
    if (envelope.schemaVersion !== PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION || !/^[0-9a-f]{64}$/.test(envelope.snapshotDigest) || snapshotDigest(envelope.snapshot) !== envelope.snapshotDigest || canonicalJSON(envelope) !== raw) fail("STATE_TAMPERED", "Product Session Gateway state envelope is invalid");
    return { ...envelope, identity: { dev: stat.dev, ino: stat.ino, size: stat.size, digest: envelope.snapshotDigest } };
  } finally { closeSync(descriptor); }
}

function snapshotDigest(value) { return createHash("sha256").update(canonicalJSON(value)).digest("hex"); }
function pathname(value) { try { const parsed = new URL(value, "http://127.0.0.1"); if (parsed.search || parsed.hash) fail("INVALID_PATH", "Product Session Gateway URL must not contain query or fragment"); return parsed.pathname; } catch (caught) { if (caught instanceof WalletAuthError) throw caught; fail("INVALID_PATH", "Product Session Gateway URL is invalid"); } }
function canonicalOrigin(value) { if (Array.isArray(value) || typeof value !== "string" || value.length > 255 || value.trim() !== value) fail("ORIGIN_NOT_ALLOWED", "Product Session Gateway origin is not registered"); let parsed; try { parsed = new URL(value); } catch { fail("ORIGIN_NOT_ALLOWED", "Product Session Gateway origin is not registered"); } if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.origin !== value) fail("ORIGIN_NOT_ALLOWED", "Product Session Gateway origin is not registered"); return parsed.origin; }
function validRequestId(value) { return typeof value === "string" && /^req_[A-Za-z0-9_-]{12,80}$/.test(value); }
function singleHeader(value) { return typeof value === "string" ? value : ""; }
function allowedHeaders(route) { return WALLET_SESSION_CONTROL_PATHS.includes(route) ? WALLET_CORS_ALLOWED_HEADERS : CORS_ALLOWED_HEADERS; }
function nullableHeader(value) { return value === undefined ? null : Array.isArray(value) ? "" : value; }
function noFollow() { return constants.O_NOFOLLOW ?? 0; }
function ownedByProcess(stat) { return typeof process.getuid !== "function" || stat.uid === process.getuid(); }
async function boundedBody(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 1_048_576) fail("BODY_TOO_LARGE", "Product Session Gateway body exceeds policy"); chunks.push(chunk); } return Buffer.concat(chunks).toString("utf8"); }
function hostError(error) { if (!(error instanceof WalletAuthError)) return { status: 500, code: "INTERNAL", message: "Product Session Gateway host failed closed" }; const status = error.code === "CLOCK_UNAVAILABLE" ? 503 : error.code === "ORIGIN_NOT_ALLOWED" ? 403 : error.code === "ROUTE_NOT_FOUND" ? 404 : error.code === "METHOD_NOT_ALLOWED" ? 405 : error.code === "BODY_TOO_LARGE" ? 413 : error.code.startsWith("STATE_") ? 500 : 400; return { status, code: error.code, message: error.message }; }
function fail(code, message) { throw new WalletAuthError(code, message); }
