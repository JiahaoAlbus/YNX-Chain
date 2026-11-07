// Fixed package-private Auth -> original finite3 LINK owner adapter. Transport
// DATA/terminal EOF never becomes Source current, a receipt or a reservation.
import{createRequire}from'node:module';
const fault=c=>Object.assign(Error(c),{code:c}),method=(v,k)=>{if(typeof v?.[k]!=='function')throw fault('TASK_RESOURCE_ORIGINAL_'+k+'_NOT_SUPPLIED');return v[k].bind(v)};
const sync=(v,k,...a)=>{if(method(v,k)(...a)!==undefined)throw fault('TASK_RESOURCE_VOID_RESULT')};
export async function openOriginalTaskReadTransport(nativeRoot,profile,modulePath,id,wire,options){
 let transport,response,data,first,sourceError,transportError,settled=false,retired=false,joined=false,closed=false,releaseSelected=false,releaseDone=false,closeSelected=false,closeWork;
 const remember=cause=>{first??={cause};return first.cause};
 const sourceCurrent=()=>{try{sync(nativeRoot,'assertNativeCurrent')}catch(cause){sourceError??={cause};throw cause}};
 const observeTransport=()=>{if(!transport)return;const actual=method(transport,'lifetime')();if(actual.firstCausePresent===true){const cause=method(transport,'firstCause')();transportError??={cause};remember(cause)}};
 const paired=physicalDone=>Object.freeze({physicalDone,errorPresent:!!first,error:first?first.cause:null,sourceFirstPresent:!!sourceError,sourceFirst:sourceError?.cause,transportFirstPresent:!!transportError,transportFirst:transportError?.cause});
 function release(){if(!response||releaseDone)return;if(releaseSelected)throw fault('TASK_RESOURCE_RESPONSE_RELEASE_UNKNOWN');releaseSelected=true;method(response,'release')();releaseDone=true;}
 const owner=Object.freeze({
  assertCurrent(){if(retired||closed)throw fault('TASK_RESOURCE_TRANSPORT_RETIRED');if(sourceError)throw sourceError.cause;sourceCurrent();if(!settled&&transport)method(transport,'current')();},
  retire(){if(!retired){retired=true;if(transport)try{method(transport,'retire')()}catch(cause){remember(cause)}finally{observeTransport()}}},
  async join(){try{release();owner.retire();if(!transport){joined=true;return paired(true)}try{await method(transport,'join')()}catch(cause){remember(cause)}observeTransport();joined=method(transport,'lifetime')().joined===true;if(!joined&&!first)remember(fault('TASK_RESOURCE_JOIN_PENDING'));return paired(joined)}catch(cause){remember(cause);return paired(false)}},
  close(){if(closed)return Promise.resolve(paired(true));return closeWork??=(async()=>{try{const drain=await owner.join();if(!drain.physicalDone)return paired(false);if(!transport){closed=true;return paired(true)}if(closeSelected)throw fault('TASK_RESOURCE_CLOSE_UNKNOWN');closeSelected=true;const outcome=await method(transport,'close')();if(!outcome||typeof outcome.errorPresent!=='boolean'||typeof outcome.physicalDone!=='boolean')throw fault('TASK_RESOURCE_CLOSE_STATUS');if(outcome.errorPresent)remember(outcome.error);observeTransport();closed=outcome.physicalDone===true;if(!closed&&!first)remember(fault('TASK_RESOURCE_CLOSE_PENDING'));return paired(closed)}catch(cause){remember(cause);try{observeTransport()}catch{}return paired(false)}})()},
  isClosed(){return closed;},
  isJoined(){return joined;},
  firstCause(){return paired(closed)},
  lifetime(){const actual=transport?method(transport,'lifetime')():null;return Object.freeze({retired,joined,closed,responseHeld:!!response&&!releaseDone,transport:actual})}
 });
 try{
  sourceCurrent();const module=createRequire(import.meta.url)(modulePath);sourceCurrent();
  const acquired=await method(module,'openOriginalTaskReadResourceCaller')(profile,options);transport=acquired?.owner; // partial FIRST
  observeTransport();
  if(!acquired||typeof acquired.errorPresent!=='boolean')throw fault('TASK_RESOURCE_TRANSPORT_ACQUIRE_STATUS');if(acquired.errorPresent)throw acquired.error;if(!transport)throw fault('TASK_RESOURCE_TRANSPORT_OWNER_REQUIRED');
  owner.assertCurrent();
  const exchanged=await method(transport,'exchange')(id,wire,options);response=exchanged?.response;settled=true; // response FIRST
  if(response)data=method(response,'copyDATA')(); // retain actual prefix before status/current
  if(!exchanged||typeof exchanged.errorPresent!=='boolean')remember(fault('TASK_RESOURCE_TRANSPORT_EXCHANGE_STATUS'));
  else if(exchanged.errorPresent)remember(exchanged.error);
  observeTransport();
  // Current after complete HTTP is INDEPENDENT Source current. LINK may have
  // a physically known terminal EOF; its old connected Current must not be
  // called here or accepted as permission to skip this Source check.
  try{sourceCurrent()}catch(cause){remember(cause)}
  if(!first&&(!data||data.bodyComplete!==true||data.method!=='POST'||data.service!=='ynx-ai-original-task-read-v1'||!(data.body instanceof Uint8Array)))remember(fault('TASK_RESOURCE_TRANSPORT_RESPONSE_DATA'));
 }catch(cause){remember(cause);settled=true;try{sourceCurrent()}catch(late){remember(late)}}
 return Object.freeze({owner,errorPresent:!!first,error:first?first.cause:null,sourceCurrentErrorPresent:!!sourceError,sourceCurrentError:sourceError?.cause,data:data??null});
}
