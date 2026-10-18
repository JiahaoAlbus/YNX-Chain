import {request as httpsRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {X509Certificate,createHash} from 'node:crypto';
import {NORMAL_OPERATOR,CANONICAL_NETWORK_ID} from '../../original-policy-supplier/operator-query.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {PQ_PROGRESS_RESPONSE_BYTES} from '../../wallet-pq-progress.mjs';
import {planPQTransferFinalityCollector,PQ_FINALITY_COLLECTOR_LIMITS} from './finality-collector.mjs';
import {inspectPQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import {PQ_TYPED_QUERY_MAX_BYTES} from './typed-action-query.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
function healthy(value) {
  if(value?.chainId!==6423||value.catchingUp!==false||value.persistence!==true||value.persistenceError!==''||value.build?.commit!==NORMAL_OPERATOR.reportedCommit||value.build?.release!==NORMAL_OPERATOR.reportedRelease) fail('PQ_TRANSACTION_NODE_VERSION_OR_HEALTH');
}
function tlsIdentity(host,cert) {
  const error=checkServerIdentity(host,cert);if(error)return error;
  try {const spki=new X509Certificate(cert.raw).publicKey.export({format:'der',type:'spki'});if(createHash('sha256').update(spki).digest('hex')!==NORMAL_OPERATOR.spkiSha256)return Error('PQ_TRANSACTION_NODE_TLS_PIN');}
  catch {return Error('PQ_TRANSACTION_NODE_TLS_PIN');}
}

/** Bounded Node transport kernel. Injection exists only for deterministic I/O
 * tests; the normal factory below always uses node:https and the EXISTING
 * owner-controlled origin, SPKI, network and release pins. It grants no
 * permission and must only be called by the separately authorized controller.
 */
export class PQTransactionNodeTransportKernel {
  constructor(requestImpl,clock=Date.now) {this.requestImpl=requestImpl;this.clock=clock;}
  async #exchange(path,{method='GET',body=null,deadline,metadata=false,assertCurrent=null,finalityBytes=false,typedQuery=false}) {
    const remaining=Math.min(NORMAL_OPERATOR.readTimeoutMs,deadline-this.clock());
    if(remaining<=0)fail('PQ_TRANSACTION_NODE_TIMEOUT');
    return new Promise((resolve,reject)=>{
      let settled=false,size=0,timer,req,response,slab=null,used=0;const chunks=[];
      const destroy=stream=>{try {stream?.destroy();}catch {/* Preserve the original failure. */}};
      const finish=(error,value)=>{
        if(settled)return;settled=true;clearTimeout(timer);chunks.length=0;slab=null;used=0;
        if(error){destroy(response);destroy(req);reject(error);}else resolve(value);
      };
      const stop=code=>finish(Object.assign(Error(code),{code}));
      const maximum=typedQuery?PQ_TYPED_QUERY_MAX_BYTES:finalityBytes?PQ_FINALITY_COLLECTOR_LIMITS.proofBytes+PQ_FINALITY_COLLECTOR_LIMITS.envelopeBytes:PQ_PROGRESS_RESPONSE_BYTES;
      try {
        assertCurrent?.();
        req=this.requestImpl(new URL(path,NORMAL_OPERATOR.origin),{method,agent:false,rejectUnauthorized:true,checkServerIdentity:tlsIdentity,headers:{accept:'application/json','cache-control':'no-cache',...(finalityBytes||typedQuery?{'accept-encoding':'identity'}:{}),...(body?{'content-type':'application/octet-stream','content-length':String(body.length)}:{})}},res=>{
          // Install error handling before any destroy, including header errors.
          res.on('error',error=>finish(error));
          if(settled){destroy(res);return;}
          response=res;let ended=false;
          res.on('aborted',()=>stop('PQ_TRANSACTION_NODE_RESPONSE_ABORTED'));
          res.on('close',()=>{if(!ended)stop('PQ_TRANSACTION_NODE_RESPONSE_ABORTED');});
          const status=res.statusCode,contentType=String(res.headers['content-type']??'').split(';')[0].trim().toLowerCase();
          if(!Number.isInteger(status)||status<200||status>=300&&status<400||contentType!=='application/json'||metadata&&status!==200||finalityBytes&&![200,202,502].includes(status)||typedQuery&&![200,202].includes(status)){stop('PQ_TRANSACTION_NODE_RESPONSE');return;}
          if(!metadata&&!String(res.headers['cache-control']??'').toLowerCase().split(',').some(v=>v.trim()==='no-store')){stop('PQ_TRANSACTION_NODE_CACHE_POLICY');return;}
          if(typedQuery&&res.headers['content-encoding']!==undefined&&res.headers['content-encoding']!=='identity'){stop('PQ_TRANSACTION_NODE_RESPONSE');return;}
          res.on('data',chunk=>{
            if(settled)return;
            if(!Buffer.isBuffer(chunk)){stop('PQ_TRANSACTION_NODE_RESPONSE');return;}
            size+=chunk.length;if(size>maximum){stop('PQ_TRANSACTION_NODE_RESPONSE_SIZE');return;}
            // Bounded slabs also bound object overhead for tiny peer chunks.
            // Copy immediately; no peer-owned Buffer survives this callback.
            for(let offset=0;offset<chunk.length;){
              if(slab===null){slab=Buffer.allocUnsafe(Math.min(maximum,1024*1024));used=0;}
              const count=Math.min(slab.length-used,chunk.length-offset);
              chunk.copy(slab,used,offset,offset+count);used+=count;offset+=count;
              if(used===slab.length){chunks.push(slab);slab=null;used=0;}
            }
          });
          res.on('end',()=>{
            if(settled)return;ended=true;
            if(res.complete===false){stop('PQ_TRANSACTION_NODE_RESPONSE_ABORTED');return;}
            try {
              if(used)chunks.push(slab.subarray(0,used));
              const bytes=Buffer.concat(chunks,size);
              finish(null,Object.freeze(typedQuery?{method:'GET',requestPath:path,status,contentType:String(res.headers['content-type']),cacheControl:String(res.headers['cache-control']),body:new Uint8Array(bytes)}:finalityBytes?{status,rawBytes:bytes}:{status,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)}));
            }catch {stop(finalityBytes?'PQ_TRANSACTION_NODE_RESPONSE':'PQ_TRANSACTION_NODE_UTF8');}
          });
        });
        req.on('error',error=>finish(error));
        if(settled){destroy(req);return;}
        // Node may close the socket after a complete HTTP message while its
        // buffered response still awaits end. Keep draining under the deadline.
        req.on('close',()=>{if(!settled&&response?.complete!==true)stop('PQ_TRANSACTION_NODE_RESPONSE_ABORTED');});
        timer=setTimeout(()=>stop('PQ_TRANSACTION_NODE_TIMEOUT'),remaining);
        assertCurrent?.();
        req.end(body??undefined);
      } catch(error) {finish(error);}
    });
  }
  async #preflight(deadline,assertCurrent=null) {
    const status=await this.#exchange('/status',{deadline,metadata:true,assertCurrent});
    let health;try {health=JSON.parse(status.text);}catch {fail('PQ_TRANSACTION_NODE_JSON');}healthy(health);
    const genesis=await this.#exchange('/blocks/0',{deadline,metadata:true,assertCurrent});
    let block;try {block=JSON.parse(genesis.text);}catch {fail('PQ_TRANSACTION_NODE_JSON');}
    if(block?.height!==0||block.hash!==CANONICAL_NETWORK_ID)fail('PQ_TRANSACTION_NODE_NETWORK');
  }
  async submitTransfer(input,assertCurrent) {
    if(typeof assertCurrent!=='function')fail('PQ_TRANSACTION_NODE_CURRENT_REQUIRED');
    assertCurrent();
    // Never accept an arbitrary URL, alternate wire, or caller body hash.
    const expected=preparePQTransferTransport(input?.body);
    if(input.method!==expected.method||input.path!==expected.path||input.contentType!==expected.contentType||input.transportHash!==expected.transportHash||input.admissionIsFinality!==false)fail('PQ_TRANSACTION_NODE_REQUEST');
    const deadline=this.clock()+NORMAL_OPERATOR.lifetimeMs;await this.#preflight(deadline);
    // Return the authenticated raw response immediately so original custody
    // captures it before any post-effect current/finality check.
    assertCurrent();
    return this.#exchange(expected.path,{method:expected.method,body:expected.body,deadline,assertCurrent});
  }
  async readOriginal(hash) {
    if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/.test(hash))fail('PQ_TRANSACTION_NODE_HASH');
    const deadline=this.clock()+NORMAL_OPERATOR.lifetimeMs;await this.#preflight(deadline);
    return this.#exchange('/transactions/pq/originals/'+hash,{deadline});
  }
  async readTypedActionOriginal(review,raw,original,assertCurrent) {
    if(typeof assertCurrent!=='function')fail('PQ_TRANSACTION_NODE_CURRENT_REQUIRED');
    assertCurrent();
    const local=inspectPQReviewedTypedTransportOriginal(review,raw,original);
    if(local.networkId!==CANONICAL_NETWORK_ID)fail('PQ_TRANSACTION_NODE_NETWORK');
    const start=this.clock(),deadline=start+NORMAL_OPERATOR.lifetimeMs;
    await this.#preflight(deadline,assertCurrent);assertCurrent();
    // Only original transportHash chooses the ABCI route, which can observe
    // indexed rejection. No body/URL/credentials or signing surface leaves here.
    const response=await this.#exchange('/transactions/pq/actions/'+local.transportHash,{deadline,typedQuery:true,assertCurrent});
    assertCurrent();
    const post=await this.#exchange('/status',{deadline,metadata:true,assertCurrent});
    let health;try{health=JSON.parse(post.text);}catch{fail('PQ_TRANSACTION_NODE_JSON');}healthy(health);
    const now=this.clock();if(now<start||now>=deadline)fail('PQ_TRANSACTION_NODE_TIMEOUT');
    assertCurrent();return response;
  }
  async readFinalityProof(original,binding) {
    // Derive only from the exact retained original before any await. Caller
    // URLs, RPC claims and native receipt hashes cannot select this endpoint.
    const plan=planPQTransferFinalityCollector(original,binding);
    if(binding.networkId!==CANONICAL_NETWORK_ID)fail('PQ_TRANSACTION_NODE_NETWORK');
    const deadline=this.clock()+NORMAL_OPERATOR.lifetimeMs;await this.#preflight(deadline);
    // Main-only unverified bytes: protected evidence capture precedes parsing,
    // independent host-context verification and any finality decision.
    return this.#exchange(plan.path,{deadline,finalityBytes:true});
  }
}
export function createPQTransactionNodeTransport() {
  const kernel=new PQTransactionNodeTransportKernel(httpsRequest);
  return Object.freeze({submitTransfer:(request,assertCurrent)=>kernel.submitTransfer(request,assertCurrent),readOriginal:hash=>kernel.readOriginal(hash),readFinalityProof:(original,binding)=>kernel.readFinalityProof(original,binding)});
}
