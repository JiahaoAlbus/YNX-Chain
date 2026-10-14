import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,randomUUID} from 'node:crypto';
const {createVideoAPI}=await import(process.env.YNX_VIDEO_API_SOURCE||new URL('./video-api.js',import.meta.url));
const key='ynx.video.pending-mutations.v1';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
class Locks {
  constructor(){this.active=false;this.queue=[];}
  request(name,{signal,mode='exclusive'}={},callback){
    assert.equal(name,key);assert.equal(mode,'exclusive');
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(signal.reason);return;}
      const item={callback,resolve,reject,signal};item.cancel=()=>{this.queue=this.queue.filter(row=>row!==item);reject(signal.reason);};signal?.addEventListener('abort',item.cancel,{once:true});this.queue.push(item);this.next();
    });
  }
  next(){if(this.active||!this.queue.length)return;this.active=true;const item=this.queue.shift();item.signal?.removeEventListener('abort',item.cancel);Promise.resolve().then(()=>item.callback({name:key,mode:'exclusive'})).then(item.resolve,item.reject).finally(()=>{this.active=false;this.next();});}
}
function browser(){const values=new Map();return {isSecureContext:true,crypto:webcrypto,navigator:{locks:new Locks()},localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)}};}
function client(environment,fetch,getAccount=()=> 'owner-a',extra={}){return createVideoAPI({baseURL:'https://video.ynxweb4.com/video/api',environment,getAccount,authorize:async()=>({'X-YNX-Product-Session-Proof-V2':'secret-proof-not-for-disk'}),fetch,...extra});}
const post=(api,path='/v1/playlists',extra={})=>api(path,{private:true,method:'POST',body:'{"private":"original body"}',...extra});
const rows=environment=>JSON.parse(environment.localStorage.getItem(key)||'{"records":[]}').records;

test('durable Video reinitialization restores original UNKNOWN without fetch or replacement key',async()=>{
  const environment=browser();let calls=0,keys=0;const cause=new TypeError('secret diagnostic');
  const dependencies={requestId:()=>{keys++;return randomUUID();}};
  const first=client(environment,async()=>{calls++;throw cause;},undefined,dependencies);await assert.rejects(post(first));
  const second=client(environment,async()=>{calls++;return new Response('{}');},undefined,dependencies);let error;try{await post(second);}catch(value){error=value;}
  assert.equal(calls,1);assert.equal(keys,1);assert.equal(error.code,'VIDEO_MUTATION_UNKNOWN');const record=rows(environment)[0];assert.equal(record.key,error.pending.key);assert.equal(record.state,'UNKNOWN');assert.equal(record.bodyBytes,27);assert.match(record.bodyDigest,/^[a-f0-9]{64}$/);
  const digest=[...new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode('{"private":"original body"}')))].map(value=>value.toString(16).padStart(2,'0')).join('');assert.equal(record.bodyDigest,digest);
  assert.doesNotMatch(environment.localStorage.getItem(key),/secret-proof|original body|secret diagnostic|Authorization/);assert.equal(record.firstCause.name,'TypeError');
});
test('durable Video simultaneous same-route instances reserve once',async()=>{
  const environment=browser(),started=deferred(),release=deferred();let calls=0,keys=0;
  const fetch=async()=>{calls++;started.resolve();await release.promise;throw Error('lost original result');};const dependencies={requestId:()=>{keys++;return randomUUID();}};
  const one=post(client(environment,fetch,undefined,dependencies)).catch(error=>error);const two=post(client(environment,fetch,undefined,dependencies)).catch(error=>error);
  await started.promise;await turn();release.resolve();const outcomes=await Promise.all([one,two]);assert.equal(calls,1);assert.equal(keys,1);assert.equal(rows(environment).length,1);assert.ok(outcomes.every(error=>error.code==='VIDEO_MUTATION_UNKNOWN'));
});
test('durable Video different routes/actors merge and exact cleanup preserves the other record',async()=>{
  const environment=browser(),first=deferred(),second=deferred();let calls=0;
  const one=post(client(environment,()=>{calls++;return first.promise;},()=> 'owner-a')).catch(error=>error);
  const two=post(client(environment,()=>{calls++;return second.promise;},()=> 'owner-b'),'/v1/videos/other/comments').catch(error=>error);
  try{
    for(let i=0;i<100&&calls<2;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(calls,2);assert.equal(rows(environment).length,2);
    first.resolve(new Response('{}'));await one;assert.equal(rows(environment).length,1);assert.equal(rows(environment)[0].account,'owner-b');second.resolve(new Response('{}'));await two;assert.equal(rows(environment).length,0);
  }finally{first.resolve(new Response('{}'));second.resolve(new Response('{}'));await Promise.all([one,two]);}
});
test('durable Video missing lock/storage/corrupt/quota/unreadback refuses new write but permits GET',async()=>{
  for(const mode of ['no-lock','insecure','lock-denied','storage-denied','quota','silent','corrupt']){
    const environment=browser();if(mode==='no-lock')environment.navigator={};if(mode==='insecure')environment.isSecureContext=false;if(mode==='lock-denied')environment.navigator.locks.request=()=>Promise.reject(Error('denied'));
    if(mode==='storage-denied')environment.localStorage.getItem=()=>{throw Error('denied')};if(mode==='quota')environment.localStorage.setItem=()=>{throw new DOMException('full','QuotaExceededError')};if(mode==='silent')environment.localStorage.setItem=()=>{};if(mode==='corrupt')environment.localStorage.setItem(key,'{');
    let calls=0;const api=client(environment,async()=>{calls++;return new Response('{}');});let error;try{await post(api);}catch(value){error=value;}assert.equal(calls,0,mode);assert.ok(['VIDEO_MUTATION_STORAGE_UNAVAILABLE','VIDEO_MUTATION_LOCK_UNAVAILABLE'].includes(error.code));await api('/v1/videos');assert.equal(calls,1);
  }
});
test('durable Video queued abort/account retirement cannot dispatch or mint key',async()=>{
  for(const change of [false,true]){
    const environment=browser(),held=deferred();const holding=environment.navigator.locks.request(key,{},()=>held.promise);await turn();let account='owner-a',calls=0,keys=0;
    const api=client(environment,async()=>{calls++;return new Response('{}');},()=>account,{requestId:()=>{keys++;return randomUUID();}}),cancel=new AbortController();const operation=post(api,'/v1/playlists',{signal:cancel.signal}).catch(error=>error);
    try{for(let i=0;i<50&&!environment.navigator.locks.queue.length;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(calls,0);if(change)account='owner-b';cancel.abort(new Error(change?'account changed':'caller cancelled'));const error=await operation;assert.match(error.message,/changed|cancelled/);assert.equal(calls,0);assert.equal(keys,0);}finally{held.resolve();await holding;}
  }
});
test('durable Video capacity/signout-reinitialization and failed UNKNOWN update retain every original fence',async()=>{
  const environment=browser(),write=environment.localStorage.setItem;let writes=0,calls=0;environment.localStorage.setItem=(k,v)=>{if(++writes>1)throw new DOMException('full','QuotaExceededError');write(k,v);};
  const first=client(environment,async()=>{calls++;throw Error('lost');});await assert.rejects(post(first));assert.equal(rows(environment).length,1,'pre-dispatch fence must be durable');assert.equal(rows(environment)[0].state,'DISPATCHED');const original=environment.localStorage.getItem(key);const second=client(environment,async()=>{calls++;return new Response('{}');});await assert.rejects(post(second),{code:'VIDEO_MUTATION_UNKNOWN'});assert.equal(calls,1);assert.equal(environment.localStorage.getItem(key),original);
  environment.localStorage.setItem=write;const records=Array.from({length:64},(_,i)=>({...rows(environment)[0],path:`/v1/videos/item${i}/comments`}));const full=JSON.stringify({version:1,records});write(key,full);const third=client(environment,async()=>{assert.fail('capacity must not prune or dispatch')});await assert.rejects(post(third),{code:'VIDEO_MUTATION_STORAGE_UNAVAILABLE'});assert.equal(environment.localStorage.getItem(key),full);
});
test('durable Video lock grant rechecks account even without an abort event',async()=>{
  const environment=browser(),held=deferred();const holding=environment.navigator.locks.request(key,{},()=>held.promise);await turn();let account='owner-a',calls=0,keys=0,proofs=0;
  const api=client(environment,async()=>{calls++;return new Response('{}');},()=>account,{requestId:()=>{keys++;return randomUUID();},authorize:async()=>{proofs++;return {};}});const result=post(api).catch(error=>error);
  for(let i=0;i<50&&!environment.navigator.locks.queue.length;i++)await new Promise(resolve=>setTimeout(resolve,5));account='owner-b';held.resolve();await holding;const error=await result;assert.equal(calls,0);assert.equal(keys,0);assert.equal(proofs,0);assert.match(error.message,/account changed/);
});
test('durable Video safe read retry and proof failure preserve original admission behavior',async()=>{
  const environment=browser();let reads=0,writes=0;const api=client(environment,async(_url,init)=>{if(init.method==='POST')writes++;else if(++reads===1)throw Error('read interrupted');return new Response('{}');},undefined,{authorize:async()=>{throw Error('SDK authority unavailable');}});
  assert.deepEqual(await api('/v1/videos'),{});assert.equal(reads,2);await assert.rejects(post(api),/authority unavailable/);assert.equal(writes,0);assert.equal(rows(environment).length,0);
});
test('durable Video account switch and library snapshot never release original UNKNOWN',async()=>{
  const environment=browser();let account='owner-a',writes=0;
  const fetch=async(_url,init)=>{if(init.method==='POST'&&++writes===1)throw Error('lost original');return new Response('{}');};
  await assert.rejects(post(client(environment,fetch,()=>account)));assert.equal(rows(environment).length,1,'original UNKNOWN must survive retiring this API instance');const original=rows(environment)[0].key;
  account=null;const reinitialized=client(environment,fetch,()=>account);await reinitialized('/v1/videos');account='owner-b';await post(reinitialized);assert.equal(rows(environment).length,1);assert.equal(rows(environment)[0].key,original);
  account='owner-a';await reinitialized('/v1/playlists',{private:true});await assert.rejects(post(reinitialized),{code:'VIDEO_MUTATION_UNKNOWN'});assert.equal(writes,2);assert.equal(rows(environment)[0].key,original);
});
