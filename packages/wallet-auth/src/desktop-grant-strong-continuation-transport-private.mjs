// Package-private compositor only. The Native Root supplies the reviewed
// carrier reference; the existing inventory supplies the SAME recognized child.
// No sibling-path lookup, alternate ABI, Source constructor or JSON capability.
import{createRequire}from'node:module';
const fail=c=>{throw Object.assign(Error(c),{code:c})};
const method=(v,k)=>{if(typeof v?.[k]!=='function')fail('TASK_STRONG_CONTINUATION_'+k+'_NOT_SUPPLIED');return v[k].bind(v)};
export async function openOriginalTaskReadStrongTransport(nativeRoot,profile,modulePath,wire,heldChild,options){
 if(!(wire instanceof Uint8Array)||wire.length<1||wire.length>1048576)fail('TASK_STRONG_CONTINUATION_BODY_BOUND');
 const body=Buffer.from(wire); // Freeze actual original entity before any await.
 let carrier,response,data,first,sourceFirst,retired=false,joined=false,closed=false,released=false,releaseSelected=false,closeWork;
 const remember=error=>{first??={error}};
 const sourceCurrent=()=>{try{if(method(nativeRoot,'assertNativeCurrent')()!==undefined)fail('TASK_STRONG_CONTINUATION_CURRENT_VOID')}catch(error){sourceFirst??={error};throw error}};
 const pair=physicalDone=>Object.freeze({physicalDone,errorPresent:!!first,error:first?first.error:null,sourceFirstPresent:!!sourceFirst,sourceFirst:sourceFirst?.error});
 const release=()=>{if(!response||released)return;if(releaseSelected)fail('TASK_STRONG_CONTINUATION_RELEASE_UNKNOWN');releaseSelected=true;method(response,'release')();released=true};
 const owner=Object.freeze({
  async assertCurrent(){if(retired||closed)fail('TASK_STRONG_CONTINUATION_RETIRED');if(first)throw first.error;sourceCurrent();if(carrier)await method(carrier,'current')();sourceCurrent()},
  retire(){if(!retired){retired=true;if(carrier)try{method(carrier,'retire')()}catch(error){remember(error)}}},
  async join(){try{release();owner.retire();if(!carrier){joined=true;return pair(true)}const r=await method(carrier,'join')();if(!r||typeof r.physicalDone!=='boolean'||typeof r.errorPresent!=='boolean')fail('TASK_STRONG_CONTINUATION_JOIN_STATUS');if(r.errorPresent)remember(r.error);joined=r.physicalDone;return pair(joined)}catch(error){remember(error);return pair(false)}},
  close(){return closeWork??=(Promise.resolve().then(async()=>{const r=await owner.join();if(!r.physicalDone)return pair(false);try{if(!carrier){closed=true;return pair(true)}const c=await method(carrier,'close')();if(!c||typeof c.physicalDone!=='boolean'||typeof c.errorPresent!=='boolean')fail('TASK_STRONG_CONTINUATION_CLOSE_STATUS');if(c.errorPresent)remember(c.error);closed=c.physicalDone;return pair(closed)}catch(error){remember(error);return pair(false)}}))},
  isJoined(){return joined},isClosed(){return closed},firstCause(){return pair(closed)},
  lifetime(){return Object.freeze({retired,joined,closed,responseHeld:!!response&&!released,carrier:carrier?method(carrier,'lifetime')():null})}
 });
 try{
  sourceCurrent();const ns=createRequire(import.meta.url)(modulePath);sourceCurrent();
  // One fixed export, never the old physical open API or flat transport shape.
  const acquired=await method(ns,'openOriginalTaskReadContinuationTransport')(profile,body,heldChild,options);carrier=acquired?.owner;
  if(!acquired||typeof acquired.errorPresent!=='boolean')fail('TASK_STRONG_CONTINUATION_OPEN_STATUS');if(acquired.errorPresent)throw acquired.error;if(!carrier)fail('TASK_STRONG_CONTINUATION_OWNER_REQUIRED');
  sourceCurrent();const exchanged=await method(carrier,'exchange')(options);response=exchanged?.response; // Partial FIRST.
  if(response){const copied=method(response,'copyDATA')();data=copied&&Object.freeze({...copied,...(copied.body instanceof Uint8Array?{body:Buffer.from(copied.body)}:{})})}
  if(!exchanged||typeof exchanged.errorPresent!=='boolean')fail('TASK_STRONG_CONTINUATION_EXCHANGE_STATUS');if(exchanged.errorPresent)throw exchanged.error;
  sourceCurrent();
  if(!data||data.bodyComplete!==true||data.method!=='POST'||data.service!=='ynx-ai-original-task-read-v1'||!(data.body instanceof Uint8Array)||data.body.length>1048576)fail('TASK_STRONG_CONTINUATION_PACKET');
 }catch(error){remember(error);try{sourceCurrent()}catch(late){remember(late)}}
 // LINK never retires/closes Auth's held child. The caller retains it until
 // this owned packet and carrier are physically drained, including late errors.
 return Object.freeze({owner,errorPresent:!!first,error:first?first.error:null,data:data??null,sourceCurrentErrorPresent:!!sourceFirst});
}
