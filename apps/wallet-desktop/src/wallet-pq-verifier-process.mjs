import {spawn as nodeSpawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {exactData} from './features/pq-transaction/transfer-binding.mjs';
import {PQ_FINALITY_EVIDENCE_LIMITS as limits} from './wallet-pq-finality-evidence.mjs';
const error=code=>Object.assign(Error(code),{code});
const digest=value=>createHash('sha256').update(value).digest('hex');
/** One fixed caller invocation, never a signer, provider or authority source.
 * Injection is restricted to this PUBLIC test kernel. The packaged factory
 * supplies its own fixed prepare and node:child_process implementation. */
export class PQFinalityVerifierProcessKernel {
 #used=false;#active=false;#retired=false;#child=null;#closed=false;#first;#firstPresent=false;#cleanup;#cleanupPresent=false;
 #stdout=[];#stderr=[];#sizes={stdout:0,stderr:0};#truncated={stdout:false,stderr:false};#exitCode=null;#signal=null;
 #tails={stdout:null,stderr:null};#tailSizes={stdout:0,stderr:0};#stdinSha=null;#stdinSize=0;
 #timers=[];#resolve;#reject;#settled=false;#joined;#join;#input=null;#interruption=null;
 constructor({prepare,spawn=nodeSpawn,schedule=setTimeout,unschedule=clearTimeout,timeoutMs=30000,graceMs=1000}){
  this.prepare=prepare;this.spawn=spawn;this.schedule=schedule;this.unschedule=unschedule;this.timeoutMs=timeoutMs;this.graceMs=graceMs;
  this.#joined=new Promise(resolve=>{this.#join=resolve;});
 }
 #remember(cause){if(!this.#firstPresent){this.#firstPresent=true;this.#first=cause;}}
 #clean(cause){if(!this.#cleanupPresent){this.#cleanupPresent=true;this.#cleanup=cause;}}
 #timer(fn,ms){const id=this.schedule(fn,ms);this.#timers.push(id);}
 #clear(){for(const id of this.#timers)this.unschedule(id);this.#timers=[];}
 #settle(failed,value){if(this.#settled)return;this.#settled=true;failed?this.#reject(value):this.#resolve(value);}
 #destroy(stream){try{stream?.destroy();}catch(cause){this.#clean(cause);}}
 #kill(signal){try{this.#child?.kill(signal);}catch(cause){this.#clean(cause);}}
 #stop(reason,cause=error('PQ_FINALITY_VERIFIER_'+reason.toUpperCase())){
  if(this.#closed)return;this.#remember(cause);if(this.#retired)return;this.#retired=true;this.#interruption=reason;
  this.#destroy(this.#child?.stdin);this.#kill('SIGTERM');
  if(this.#closed)return;
  this.#timer(()=>{
   if(this.#closed)return;this.#kill('SIGKILL');if(this.#closed)return;
   this.#timer(()=>{if(this.#closed)return;this.#destroy(this.#child?.stdout);this.#destroy(this.#child?.stderr);this.#settle(true,Object.assign(error('PQ_FINALITY_VERIFIER_CLEANUP_PENDING'),{partial:this,cause:this.#first}));},this.graceMs);
  },this.graceMs);
 }
 #complete(code,signal,failed=false,cause){
  if(this.#closed)return;this.#closed=true;this.#active=false;this.#clear();
  this.#exitCode=Number.isInteger(code)?code:null;this.#signal=typeof signal==='string'?signal:null;
  this.#input=null;this.#join();this.#settle(failed,failed?cause:this.snapshot());
 }
 snapshot(){
  const bytes=name=>Buffer.concat([...(name==='stdout'?this.#stdout:this.#stderr),...(this.#tailSizes[name]?[this.#tails[name].subarray(0,this.#tailSizes[name])]:[])],this.#sizes[name]);
  return Object.freeze({result:Object.freeze({stdout:bytes('stdout'),stderr:bytes('stderr'),exitCode:this.#exitCode,signal:this.#signal}),
   lifecycle:Object.freeze({started:this.#child!==null,closeObserved:this.#closed&&this.#child!==null,cleanupPending:this.#active,interruption:this.#interruption,stdoutTruncated:this.#truncated.stdout,stderrTruncated:this.#truncated.stderr,firstCausePresent:this.#firstPresent,cleanupCausePresent:this.#cleanupPresent,stdinSha256:this.#stdinSha,stdinByteLength:this.#stdinSize}),
   firstCause:this.#first,cleanupCause:this.#cleanup});
 }
 assertSafeToClose(){if(this.#active)throw error('PQ_FINALITY_VERIFIER_CLEANUP_PENDING');}
 retire(){if(!this.#used){this.#retired=true;this.#interruption='cancelled';this.#remember(error('PQ_FINALITY_VERIFIER_CANCELLED'));return;}this.#stop('cancelled');}
 join(){return this.#joined;}
 run(invocation){
  if(this.#used)return Promise.reject(error('PQ_FINALITY_VERIFIER_ALREADY_ENTERED'));this.#used=true;if(this.#retired){this.#closed=true;this.#join();return Promise.reject(error('PQ_FINALITY_VERIFIER_CANCELLED'));}this.#active=true;
  const result=new Promise((resolve,reject)=>{this.#resolve=resolve;this.#reject=reject;});
  this.#timer(()=>this.#stop('timeout'),this.timeoutMs);
  void (async()=>{
   try{
    const prepared=await this.prepare(invocation);
    exactData(prepared,['executable','contextPath','contextSha256','stdin'],'PQ_FINALITY_VERIFIER_INVOCATION_INVALID');
    for(const file of [prepared.executable,prepared.contextPath])if(typeof file!=='string'||!path.isAbsolute(file)||path.normalize(file)!==file)throw error('PQ_FINALITY_VERIFIER_INVOCATION_INVALID');
    if(typeof prepared.contextSha256!=='string'||!/^[a-f0-9]{64}$/.test(prepared.contextSha256))throw error('PQ_FINALITY_VERIFIER_INVOCATION_INVALID');
    if(typeof prepared.stdin!=='string'||Buffer.byteLength(prepared.stdin)>limits['verifier-stdin']||Buffer.from(prepared.stdin).toString('utf8')!==prepared.stdin)throw error('PQ_FINALITY_VERIFIER_INPUT_LIMIT');
    this.#input=Buffer.from(prepared.stdin);this.#stdinSha=digest(this.#input);this.#stdinSize=this.#input.length;
    if(this.#retired){this.#complete(null,null);return;}
    // No shell, inherited credentials, NODE_OPTIONS, fd4/fd5 or clock flag.
    this.#child=this.spawn(prepared.executable,['--trust-context',prepared.contextPath,'--trust-context-sha256',prepared.contextSha256],{shell:false,detached:false,windowsHide:true,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'},stdio:['pipe','pipe','pipe']});
    const child=this.#child;
    child.on('error',cause=>{this.#remember(cause);this.#stop('process-error',cause);});
    child.once('close',(code,signal)=>this.#complete(code,signal));
    for(const name of ['stdout','stderr']){
     child[name].on('error',cause=>this.#stop('stream-error',cause));
     child[name].on('data',chunk=>{
      if(this.#closed)return;
      if(!Buffer.isBuffer(chunk)){this.#stop('output-invalid');return;}
      const maximum=limits[name==='stdout'?'verifier-stdout':'verifier-stderr'],remaining=maximum-this.#sizes[name],count=Math.min(remaining,chunk.length);
      for(let offset=0;offset<count;){
       if(this.#tails[name]===null){this.#tails[name]=Buffer.allocUnsafe(Math.min(maximum,1<<20));this.#tailSizes[name]=0;}
       const copied=Math.min(count-offset,this.#tails[name].length-this.#tailSizes[name]);chunk.copy(this.#tails[name],this.#tailSizes[name],offset,offset+copied);this.#tailSizes[name]+=copied;this.#sizes[name]+=copied;offset+=copied;
       if(this.#tailSizes[name]===this.#tails[name].length){(name==='stdout'?this.#stdout:this.#stderr).push(this.#tails[name]);this.#tails[name]=null;this.#tailSizes[name]=0;}
      }
      if(count<chunk.length){this.#truncated[name]=true;this.#stop('output-limit');}
     });
    }
    child.stdin.on('error',cause=>this.#stop('stdin-error',cause));child.stdin.end(this.#input);
    if(this.#retired)this.#stop('cancelled');
   }catch(cause){
    this.#remember(cause);
    if(this.#child)this.#stop('process-error',cause);
    else this.#complete(null,null,true,Object.assign(error('PQ_FINALITY_VERIFIER_NOT_STARTED'),{cause}));
   }
  })();
  return result;
 }
}
