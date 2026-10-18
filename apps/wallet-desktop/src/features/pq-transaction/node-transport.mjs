import {request as httpsRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {X509Certificate,createHash} from 'node:crypto';
import {NORMAL_OPERATOR,CANONICAL_NETWORK_ID} from '../../original-policy-supplier/operator-query.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {PQ_PROGRESS_RESPONSE_BYTES} from '../../wallet-pq-progress.mjs';

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
  async #exchange(path,{method='GET',body=null,deadline,metadata=false,assertCurrent=null}) {
    const remaining=Math.min(NORMAL_OPERATOR.readTimeoutMs,deadline-this.clock());
    if(remaining<=0)fail('PQ_TRANSACTION_NODE_TIMEOUT');
    return new Promise((resolve,reject)=>{
      let settled=false,size=0,timer,req;const chunks=[];
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
      try {
        assertCurrent?.();
        req=this.requestImpl(new URL(path,NORMAL_OPERATOR.origin),{method,agent:false,rejectUnauthorized:true,checkServerIdentity:tlsIdentity,headers:{accept:'application/json','cache-control':'no-cache',...(body?{'content-type':'application/octet-stream','content-length':String(body.length)}:{})}},res=>{
          const status=res.statusCode,contentType=String(res.headers['content-type']??'').split(';')[0].trim().toLowerCase();
          const stop=code=>{finish(Object.assign(Error(code),{code}));res.destroy();};
          // Install error handling before any destroy, including header errors.
          res.on('error',error=>finish(error));
          if(!Number.isInteger(status)||status<200||status>=300&&status<400||contentType!=='application/json'||metadata&&status!==200){stop('PQ_TRANSACTION_NODE_RESPONSE');return;}
          if(!metadata&&!String(res.headers['cache-control']??'').toLowerCase().split(',').some(v=>v.trim()==='no-store')){stop('PQ_TRANSACTION_NODE_CACHE_POLICY');return;}
          res.on('data',chunk=>{size+=chunk.length;if(size>PQ_PROGRESS_RESPONSE_BYTES){stop('PQ_TRANSACTION_NODE_RESPONSE_SIZE');return;}chunks.push(chunk);});
          res.on('end',()=>{if(settled)return;try {finish(null,Object.freeze({status,text:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))}));}catch {finish(Object.assign(Error('PQ_TRANSACTION_NODE_UTF8'),{code:'PQ_TRANSACTION_NODE_UTF8'}));}});
        });
        req.on('error',error=>finish(error));
        timer=setTimeout(()=>{finish(Object.assign(Error('PQ_TRANSACTION_NODE_TIMEOUT'),{code:'PQ_TRANSACTION_NODE_TIMEOUT'}));req.destroy();},remaining);
        assertCurrent?.();
        req.end(body??undefined);
      } catch(error) {finish(error);req?.destroy();}
    });
  }
  async #preflight(deadline) {
    const status=await this.#exchange('/status',{deadline,metadata:true});
    let health;try {health=JSON.parse(status.text);}catch {fail('PQ_TRANSACTION_NODE_JSON');}healthy(health);
    const genesis=await this.#exchange('/blocks/0',{deadline,metadata:true});
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
}
export function createPQTransactionNodeTransport() {
  const kernel=new PQTransactionNodeTransportKernel(httpsRequest);
  return Object.freeze({submitTransfer:(request,assertCurrent)=>kernel.submitTransfer(request,assertCurrent),readOriginal:hash=>kernel.readOriginal(hash)});
}
