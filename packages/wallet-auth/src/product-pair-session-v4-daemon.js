// Actual original-daemon custody/dispatch. No caller-provided Source selector.
import {openOriginalProductPairSessionV4HTTPRoutes} from './product-pair-session-v4-http.js';
const refs=new WeakMap(),PATHS=new Set(['/v4/product-pairs','/v4/product-session-challenges','/v4/product-sessions','/v4/product-pairs/original-query','/v4/product-sessions/active','/v4/product-sessions/recover','/v4/product-sessions/revoke','/v4/product-session-challenges/cancel']);
const fail=c=>{throw Object.assign(Error(c),{code:c});};
// PUBLIC lifecycle test kernel; not accepted by dispatch's private WeakMap.
export class ProductPairSessionV4DaemonLifetimeKernel {
 #owner;#handler;#pending=new Set();#retired=false;#retireSelected=false;#retireError;#joining;#joined=false;#closing;#ownerCloseSelected=false;#ownerClosed=false;#closeCause;#failure;#disabled;#routeFailures;
 constructor(owner,handler,{failurePresent=false,failure,disabled=false,routeFailures}={}){this.#owner=owner;this.#handler=handler;this.#failure=failurePresent?{cause:failure}:null;this.#disabled=disabled;this.#routeFailures=routeFailures;}
 status(){return Object.freeze({configured:typeof this.#handler==='function'&&!this.#failure&&!this.#disabled,disabled:this.#disabled,failurePresent:!!this.#failure,firstCause:this.#failure?.cause,retired:this.#retired,pending:this.#pending.size,...(this.#routeFailures?{routeFailures:this.#routeFailures,ownerCleanup:this.#owner?.status?.()}: {}),...(this.#closing?{cleanup:Object.freeze({joined:this.#joined,ownerCloseSelected:this.#ownerCloseSelected,ownerClosed:this.#ownerClosed,firstCausePresent:!!this.#closeCause,firstCause:this.#closeCause?.cause})}:{})});}
 handle(req,res){
  if(!PATHS.has(req.url))return Promise.resolve(false);
  if(this.#retired||this.#disabled||this.#failure||typeof this.#handler!=='function'){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({code:this.#retired?'PAIR_V4_SERVICE_RETIRED':this.#disabled?'PAIR_V4_SOURCE_NOT_CONFIGURED':'PAIR_V4_SOURCE_UNAVAILABLE',authorized:false,newSession:false}));return Promise.resolve(true);}
  // Capture the real work before invoking any handler callback. retirement can
  // occur reentrantly; join waits exactly this original pending set.
  const flight=Promise.resolve().then(()=>{if(this.#retired)fail('PAIR_V4_DAEMON_RETIRED_BEFORE_ENTRY');return this.#handler(req,res);});this.#pending.add(flight);flight.then(()=>this.#pending.delete(flight),()=>this.#pending.delete(flight));return flight;
 }
 retire(){if(!this.#retireSelected){this.#retireSelected=true;this.#retired=true;try{this.#owner?.retire();}catch(cause){this.#retireError={cause};}}if(this.#retireError)throw this.#retireError.cause;}
 join(){if(this.#joined)return Promise.resolve();if(!this.#retired)fail('PAIR_V4_DAEMON_NOT_RETIRED');if(this.#joining)return this.#joining;const work=Promise.allSettled([...this.#pending]).then(async()=>{if(await this.#owner?.join()!==undefined)fail('PAIR_V4_DAEMON_JOIN_PENDING');this.#joined=true;});this.#joining=work;work.then(()=>this.#joining=undefined,()=>this.#joining=undefined);return work;}
 async #closeOwner(){if(!this.#ownerCloseSelected){this.#ownerCloseSelected=true;if(await this.#owner?.close()!==undefined)fail('PAIR_V4_DAEMON_CLOSE_PENDING');this.#ownerClosed=true;}else if(!this.#ownerClosed){if(typeof this.#owner?.drainPartial!=='function')fail('PAIR_V4_DAEMON_ORIGINAL_DRAIN_REQUIRED');if(await this.#owner.drainPartial()!==undefined)fail('PAIR_V4_DAEMON_DRAIN_PENDING');this.#ownerClosed=true;}}
 close(){if(!this.#closing)this.#closing=(async()=>{let first;try{this.retire();}catch(cause){first={cause};}try{await this.join();}catch(cause){first??={cause};this.#closeCause??=first;throw first.cause;}try{await this.#closeOwner();}catch(cause){first??={cause};}if(first){this.#closeCause??=first;throw first.cause;}})();return this.#closing;}
 async drainPartial(){if(!this.#closing||!this.#retired)fail('PAIR_V4_DAEMON_NOT_CLOSING');await this.join();await this.#closeOwner();}
}
export async function openOriginalProductPairSessionV4Daemon(...args){
 if(args.length)fail('PAIR_V4_ZERO_INPUT_REQUIRED');let owner,handler,failurePresent=false,failure,disabled=false,routeFailures;
 try{const result=await openOriginalProductPairSessionV4HTTPRoutes();owner=result.owner; // FIRST: retain original partial before error inspection.
  if(result.error!==undefined){failurePresent=true;failure=result.error;}else{handler=result.handle;routeFailures=result.routeFailures;disabled=result.routeStatus?!Object.values(result.routeStatus).some(Boolean):false;}
 }catch(cause){if(cause?.code==='PAIR_V4_SOURCE_NOT_CONFIGURED')disabled=true;else{failurePresent=true;failure=cause;}}
 const lifetime=new ProductPairSessionV4DaemonLifetimeKernel(owner,handler,{failurePresent,failure,disabled,routeFailures}),ref=Object.freeze({});refs.set(ref,lifetime);return ref;
}
const lifetime=ref=>{const l=refs.get(ref);if(!l)fail('PAIR_V4_ORIGINAL_DAEMON_REQUIRED');return l;};
export function originalProductPairSessionV4DaemonStatus(ref){return lifetime(ref).status();}
export function dispatchOriginalProductPairSessionV4Daemon(ref,req,res){if(!PATHS.has(req.url))return Promise.resolve(false);if(ref===null||ref===undefined){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end('{"code":"PAIR_V4_SOURCE_NOT_CONFIGURED","authorized":false,"newSession":false}');return Promise.resolve(true);}return lifetime(ref).handle(req,res);}
export function retireOriginalProductPairSessionV4Daemon(ref){return lifetime(ref).retire();}
export function joinOriginalProductPairSessionV4Daemon(ref){return lifetime(ref).join();}
export function closeOriginalProductPairSessionV4Daemon(ref){return lifetime(ref).close();}
export function drainOriginalProductPairSessionV4Daemon(ref){return lifetime(ref).drainPartial();}
