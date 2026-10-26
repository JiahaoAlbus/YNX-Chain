import {randomUUID} from 'node:crypto';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const fail=()=>Object.assign(Error('The original native service read channel is unavailable.'),{code:'IDE_NATIVE_SERVICE_READ_UNAVAILABLE'});
const PREFIX='@YNX_NATIVE_SERVICE_READ_V1:';
const STORAGE='ynx.product-session.v2:developer:macos:com.ynxweb4.developer.testnetpreview';
// The normal backend supplies its actual inherited stderr and sole stdin mux.
// No renderer endpoint, Source DTO, approval flag or login client is accepted.
export function createNativeServiceReadControl({control,output,instance,context,timeoutMs=10000}){
 if(!uuid(instance)||!uuid(context?.id)||typeof context.workspace!=='string'||!context.workspace.startsWith('/')||Buffer.byteLength(context.workspace)>4096||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||typeof output?.write!=='function')throw fail();
 let retired=false,selected;const pending=new Map();
 const rejectPending=reason=>{for(const row of pending.values()){clearTimeout(row.timer);row.reject(reason);}pending.clear();};
 const subscription=control.subscribe({actions:['native-service-read-result'],maxFrameBytes:65536,receive(body){
  const row=pending.get(body.id);
  if(!row||body.instance!==instance||body.projectId!==context.id||body.workspace!==context.workspace||body.requestId!==row.requestId)return;
  const keys=Object.keys(body).sort().join();
  if(keys!=='action,id,instance,ok,projectId,requestId,value,workspace'||typeof body.ok!=='boolean')return;
  pending.delete(body.id);clearTimeout(row.timer);
  if(body.ok)row.resolve(body.value);else row.reject(fail());
 },onClose(){retired=true;rejectPending(fail());}});
 function call(requestId,input){
  if(retired||!selected||selected.requestId!==requestId||pending.size>=8)return Promise.reject(fail());
  const id=randomUUID(),frame=PREFIX+JSON.stringify({version:1,id,instance,projectId:context.id,workspace:context.workspace,requestId,input})+'\n';
  if(Buffer.byteLength(frame)>32768)return Promise.reject(fail());
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(id);reject(fail());},timeoutMs);
   pending.set(id,{requestId,resolve,reject,timer});
   try{output.write(frame,error=>{if(!error)return;const row=pending.get(id);if(row){pending.delete(id);clearTimeout(timer);row.reject(error);}});}
   catch(error){pending.delete(id);clearTimeout(timer);reject(error);}
  });
 }
 return Object.freeze({
  open(requestId){
   if(retired||selected||!uuid(requestId))throw fail();
   const owner={requestId,closed:false,cleanup:undefined};selected=owner;
   const live=()=>{if(retired||owner.closed||selected!==owner)throw fail();};
   const read=async input=>{live();const value=await call(requestId,input);live();return value;};
   return Object.freeze({
    context:()=>read({operation:'context'}),
    get:key=>{if(key!==STORAGE&&key!==STORAGE+':revoke')return Promise.reject(fail());return read({operation:'get',key});},
    sign:input=>read({operation:'sign',input}),
    authorizeNetwork:url=>read({operation:'network',method:'GET',url}).then(value=>{if(value!==true)throw fail();}),
    close(){
     owner.closed=true;
     // The closed owner is retained if the original close response is unknown.
     return owner.cleanup??=(async()=>{const value=await call(requestId,{operation:'close'});if(value!==true)throw fail();if(selected===owner)selected=undefined;})();
    }
   });
  },
  close(){retired=true;rejectPending(fail());subscription.close();},
 });
}
