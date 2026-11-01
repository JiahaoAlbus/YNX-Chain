// Private normal Gateway caller custody. No Root/role/provider can be supplied
// in HTTP JSON, no signing occurs here, and the borrowed Source is never closed.
import{assertOriginalAuthSourceCurrentService}from'./original-auth-identity-source-current.js';
const fail=code=>{throw Object.assign(new Error(code),{code})};
const requests=new WeakSet();
function selected(method,url){
 const u=new URL(url,'https://wallet-auth.ynxweb4.com');
 if(method!=='GET'||u.origin!=='https://wallet-auth.ynxweb4.com'||u.pathname!=='/v1/auth-identity/source-current'||u.hash||[...u.searchParams.keys()].sort().join('|')!=='nonce|profile')fail('AUTH_SOURCE_CURRENT_REQUEST_INVALID');
 const profile=u.searchParams.get('profile'),nonce=u.searchParams.get('nonce');
 if(!/^[a-f0-9]{64}$/.test(profile??'')||!/^[A-Za-z0-9_-]{43}$/.test(nonce??'')||Buffer.from(nonce,'base64url').toString('base64url')!==nonce)fail('AUTH_SOURCE_CURRENT_REQUEST_INVALID');
 return{profile,nonce};
}
class OriginalSourceCurrentRequest {
 #source;#profile;#nonce;#promise;#raw;#entered=false;#settled=false;#cancelled=false;#retired=false;#closed=false;#closeSelected=false;#closeCause;#closeFailed=false;#cause;#causePresent=false;#phase='RETAINED';#request;#response;#onAbort;#onClose;#handed=false;
 constructor(source,selection){this.#source=source;this.#profile=selection.profile;this.#nonce=selection.nonce;requests.add(this);}
 #remember(e){if(!this.#causePresent){this.#causePresent=true;this.#cause=e;}}
 bindOriginalHTTP(request,response){
  if(this.#request||this.#response||this.#entered||this.#closed||!request||!response||typeof response.writeHead!=='function'||typeof response.end!=='function')fail('AUTH_SOURCE_CURRENT_HTTP_ALREADY_SELECTED');
  this.#request=request;this.#response=response;
  this.#onAbort=()=>this.cancel();this.#onClose=()=>{if(!response.writableFinished&&!this.#handed)this.cancel()};
  try{
   if(typeof request.once==='function')request.once('aborted',this.#onAbort);
   if(typeof response.once==='function')response.once('close',this.#onClose);
   if(request.aborted||response.destroyed)this.cancel();
  }catch(e){this.#remember(e);this.#phase='FAILED';throw e}
 }
 run(){
  if(this.#promise)return this.#promise;
  if(this.#closed||this.#retired)fail('AUTH_SOURCE_CURRENT_REQUEST_CLOSED');
  // Promise is retained before calling the foreign async owner. A duplicate
  // run observes this exact promise and can never invoke current twice.
  this.#promise=Promise.resolve().then(async()=>{
   try{
    if(this.#cancelled){this.#phase='CANCELLED';throw this.#cause}
    this.#entered=true;this.#phase='CURRENT_ENTERED';
    const raw=await this.#source.current(this.#profile,this.#nonce);
    this.#raw=raw;this.#phase='ORIGINAL_RETAINED'; // before any postcheck/error
    if(this.#cancelled||this.#retired){this.#phase='CANCELLED';if(!this.#causePresent)this.cancel();throw this.#cause}
    this.#source.assertOriginalCurrentCompletion(this.#profile,this.#nonce,raw);
    this.#phase='CURRENT_CHECKED';return raw;
   }catch(e){this.#remember(e);if(this.#phase!=='CANCELLED')this.#phase='FAILED';throw e}
   finally{this.#entered=false;this.#settled=true}
  });return this.#promise;
 }
 cancel(){
  if(this.#handed||this.#closeSelected)return;this.#cancelled=true;
  if(!this.#causePresent){try{fail('AUTH_SOURCE_CURRENT_REQUEST_CANCELLED')}catch(e){this.#remember(e)}}
 }
 writeOriginalResponse(request,response){
  if(!requests.has(this)||request!==this.#request||response!==this.#response||!this.#settled||this.#phase!=='CURRENT_CHECKED'||this.#closed)fail('AUTH_SOURCE_CURRENT_HTTP_NOT_ORIGINAL');
  try{
   if(request.aborted||response.destroyed)this.cancel();
   if(this.#cancelled||this.#retired)throw this.#cause;
   this.#source.assertOriginalCurrentCompletion(this.#profile,this.#nonce,this.#raw);
   response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(this.#raw);this.#handed=true;this.#phase='HANDED_TO_RESPONSE';
  }catch(e){this.#remember(e);this.#phase='FAILED';throw e}
  // Handed is NOT a claim that the remote client received or accepted a grant.
 }
 retire(){this.#retired=true;if(!this.#settled&&this.#promise)this.cancel()}
 join(){if(!this.#retired||this.#entered||this.#promise&&!this.#settled)fail('AUTH_SOURCE_CURRENT_REQUEST_JOIN_PENDING')}
 close(){
  if(this.#closeSelected){if(this.#closeFailed)throw this.#closeCause;return}
  this.join();this.#closeSelected=true;
  for(const work of[()=>this.#request?.removeListener?.('aborted',this.#onAbort),()=>this.#response?.removeListener?.('close',this.#onClose)])try{work()}catch(e){if(!this.#closeFailed){this.#closeFailed=true;this.#closeCause=e}}
  if(this.#closeFailed)throw this.#closeCause;this.#closed=true;
 }
 status(){return Object.freeze({phase:this.#phase,entered:this.#entered,settled:this.#settled,cancelled:this.#cancelled,retired:this.#retired,closed:this.#closed,originalRetained:this.#raw!==undefined,firstCausePresent:this.#causePresent,cleanupCausePresent:this.#closeFailed,handedToResponse:this.#handed,clientReceiptProved:false})}
}
export function openOriginalAuthSourceCurrentRequest(service,method,url){assertOriginalAuthSourceCurrentService(service);return new OriginalSourceCurrentRequest(service,selected(method,url))}
