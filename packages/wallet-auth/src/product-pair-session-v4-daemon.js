// Actual original-daemon custody/dispatch. No caller-provided Source selector.
import {openOriginalProductPairSessionV4HTTPRoutes} from './product-pair-session-v4-http.js';
const refs=new WeakMap(),PATHS=new Set(['/v4/product-pairs','/v4/product-session-challenges','/v4/product-sessions']);
const fail=c=>{throw Object.assign(Error(c),{code:c});};
// PUBLIC lifecycle test kernel; not accepted by dispatch's private WeakMap.
export class ProductPairSessionV4DaemonLifetimeKernel {
 #owner;#handler;#pending=new Set();#retired=false;#retireSelected=false;#retireError;#joining;#closing;#failure;#disabled;
 constructor(owner,handler,{failurePresent=false,failure,disabled=false}={}){this.#owner=owner;this.#handler=handler;this.#failure=failurePresent?{cause:failure}:null;this.#disabled=disabled;}
 status(){return Object.freeze({configured:typeof this.#handler==='function'&&!this.#failure&&!this.#disabled,disabled:this.#disabled,failurePresent:!!this.#failure,firstCause:this.#failure?.cause,retired:this.#retired,pending:this.#pending.size});}
 handle(req,res){
  if(!PATHS.has(req.url))return Promise.resolve(false);
  if(this.#retired||this.#disabled||this.#failure||typeof this.#handler!=='function'){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({code:this.#retired?'PAIR_V4_SERVICE_RETIRED':this.#disabled?'PAIR_V4_SOURCE_NOT_CONFIGURED':'PAIR_V4_SOURCE_UNAVAILABLE',authorized:false,newSession:false}));return Promise.resolve(true);}
  // Capture the real work before invoking any handler callback. retirement can
  // occur reentrantly; join waits exactly this original pending set.
  const flight=Promise.resolve().then(()=>{if(this.#retired)fail('PAIR_V4_DAEMON_RETIRED_BEFORE_ENTRY');return this.#handler(req,res);});this.#pending.add(flight);flight.then(()=>this.#pending.delete(flight),()=>this.#pending.delete(flight));return flight;
 }
 retire(){if(!this.#retireSelected){this.#retireSelected=true;this.#retired=true;try{this.#owner?.retire();}catch(cause){this.#retireError={cause};}}if(this.#retireError)throw this.#retireError.cause;}
 join(){if(!this.#joining){if(!this.#retired)fail('PAIR_V4_DAEMON_NOT_RETIRED');const pending=[...this.#pending];this.#joining=Promise.allSettled(pending).then(()=>this.#owner?.join());}return this.#joining;}
 close(){if(!this.#closing)this.#closing=(async()=>{let first;for(const f of [()=>this.retire(),()=>this.join(),()=>this.#owner?.close()])try{await f();}catch(cause){first??={cause};}if(first)throw first.cause;})();return this.#closing;}
}
export async function openOriginalProductPairSessionV4Daemon(...args){
 if(args.length)fail('PAIR_V4_ZERO_INPUT_REQUIRED');let owner,handler,failurePresent=false,failure,disabled=false;
 try{const result=await openOriginalProductPairSessionV4HTTPRoutes();owner=result.owner; // FIRST: retain original partial before error inspection.
  if(result.error!==undefined){failurePresent=true;failure=result.error;}else handler=result.handle;
 }catch(cause){if(cause?.code==='PAIR_V4_SOURCE_NOT_CONFIGURED')disabled=true;else{failurePresent=true;failure=cause;}}
 const lifetime=new ProductPairSessionV4DaemonLifetimeKernel(owner,handler,{failurePresent,failure,disabled}),ref=Object.freeze({});refs.set(ref,lifetime);return ref;
}
const lifetime=ref=>{const l=refs.get(ref);if(!l)fail('PAIR_V4_ORIGINAL_DAEMON_REQUIRED');return l;};
export function originalProductPairSessionV4DaemonStatus(ref){return lifetime(ref).status();}
export function dispatchOriginalProductPairSessionV4Daemon(ref,req,res){if(!PATHS.has(req.url))return Promise.resolve(false);if(ref===null||ref===undefined){res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end('{"code":"PAIR_V4_SOURCE_NOT_CONFIGURED","authorized":false,"newSession":false}');return Promise.resolve(true);}return lifetime(ref).handle(req,res);}
export function retireOriginalProductPairSessionV4Daemon(ref){return lifetime(ref).retire();}
export function joinOriginalProductPairSessionV4Daemon(ref){return lifetime(ref).join();}
export function closeOriginalProductPairSessionV4Daemon(ref){return lifetime(ref).close();}
