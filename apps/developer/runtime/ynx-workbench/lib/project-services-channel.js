'use strict';
const {randomUUID}=require('node:crypto');
const contractProtocol=require('./contract-request-protocol');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,LIMIT=1024*1024;
const failure=code=>Object.assign(Error(code||'IDE_PROJECT_SERVICE_UNAVAILABLE'),{code:code||'IDE_PROJECT_SERVICE_UNAVAILABLE'});
// Only request DATA crosses fd8. An endpoint, account, selector or provider
// must never be selected by a frontend/plugin body, even when a caller would
// otherwise ignore the extra field. Use this same check before Native reads.
function valid(action,input){
 try{
  if(!input||Object.getPrototypeOf(input)!==Object.prototype)return false;
  const descriptors=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(descriptors);
  if(keys.some(key=>typeof key!=='string'||!Object.hasOwn(descriptors[key],'value')||!descriptors[key].enumerable))return false;
  if(action==='contract')return keys.sort().join()==='action,body'&&contractProtocol.valid(input.action,input.body)&&Buffer.byteLength(JSON.stringify(input))<=65536;
  if(action==='project')return keys.length===0;
  if(action!=='cloud-observation'||keys.some(key=>!['requestId','view','period','productId','sourceOrder'].includes(key)))return false;
  return typeof input.requestId==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)&&typeof input.view==='string'&&input.view.length>0&&input.view.length<=64&&Buffer.byteLength(JSON.stringify(input))<=4096;
 }catch{return false;}
}
function wire(stream,receive,onClose){
 let buffer='',closed=false;
 const close=()=>{if(closed)return;closed=true;stream.destroy();onClose();};
 stream.setEncoding('utf8');stream.on('data',chunk=>{if(closed)return;buffer+=chunk;if(Buffer.byteLength(buffer)>LIMIT)return close();while(buffer.includes('\n')){const index=buffer.indexOf('\n'),raw=buffer.slice(0,index);buffer=buffer.slice(index+1);try{receive(JSON.parse(raw));}catch{close();return;}}});
 stream.on('error',close);stream.on('end',close);stream.on('close',close);
 return {close,send(value){const bytes=JSON.stringify(value)+'\n';if(closed||Buffer.byteLength(bytes)>LIMIT||stream.writableLength>LIMIT)throw failure();stream.write(bytes);}};
}
function serve(stream,host){
 let closed=false,cleanup;const active=new Map();
 const retire=()=>{if(closed)return;closed=true;for(const controller of active.values())controller.abort();host.retire();};
 const channel=wire(stream,message=>{
  if(!message||!UUID.test(message.id||''))throw failure();
  if(message.cancel===true&&Object.keys(message).sort().join()==='cancel,id'){active.get(message.id)?.abort();return;}
  if(Object.keys(message).sort().join()!=='action,id,input'||!valid(message.action,message.input)||active.has(message.id)||active.size>=8)throw failure();
  const controller=new AbortController();active.set(message.id,controller);
  Promise.resolve().then(()=>host.read(message.action,message.input,controller.signal)).then(result=>{
   if(!closed&&!controller.signal.aborted)channel.send({id:message.id,ok:true,result});
   else if(!closed)channel.send({id:message.id,ok:false,code:'IDE_PROJECT_REQUEST_CANCELLED'});
  }).catch(error=>{if(!closed){const code=typeof error?.code==='string'&&/^[A-Za-z0-9_]{1,100}$/.test(error.code)?error.code:'IDE_PROJECT_SERVICE_UNAVAILABLE';try{channel.send({id:message.id,ok:false,code,...(error?.code==='IDE_CONTRACT_ORIGINAL_QUERY_REQUIRED'&&UUID.test(error.referenceId||'')?{referenceId:error.referenceId}:{})});}catch{channel.close();}}}).finally(()=>active.delete(message.id));
 },retire);
 return {retire,close(){retire();channel.close();return cleanup??=host.close();}};
}
function client(stream){
 const pending=new Map();let closed=false;
 const channel=wire(stream,message=>{
  const row=pending.get(message?.id);if(!row||!(message.ok===true&&Object.keys(message).sort().join()==='id,ok,result'||message.ok===false&&['code,id,ok','code,id,ok,referenceId'].includes(Object.keys(message).sort().join())&&(message.referenceId===undefined||message.code==='IDE_CONTRACT_ORIGINAL_QUERY_REQUIRED'&&UUID.test(message.referenceId))))throw failure();
  pending.delete(message.id);row.cleanup();if(!row.cancelled)message.ok?row.resolve(message.result):row.reject(Object.assign(failure(message.code),message.referenceId?{referenceId:message.referenceId}:{}));
 },()=>{closed=true;for(const row of pending.values()){row.cleanup();row.reject(failure());}pending.clear();});
 return {request(action,input={},signal){
  if(closed||!valid(action,input)||pending.size>=8)return Promise.reject(failure());signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   const id=randomUUID(),abort=()=>{const row=pending.get(id);if(!row||row.cancelled)return;row.cancelled=true;reject(failure('IDE_PROJECT_REQUEST_CANCELLED'));try{channel.send({id,cancel:true});}catch{channel.close();}};
   const timeout=setTimeout(()=>channel.close(),action==='contract'?125000:30000);timeout.unref?.();
   pending.set(id,{resolve,reject,cancelled:false,cleanup(){clearTimeout(timeout);signal?.removeEventListener('abort',abort);}});
   signal?.addEventListener('abort',abort,{once:true});try{channel.send({id,action,input});if(signal?.aborted)abort();}catch{channel.close();}
  });
 },close:channel.close};
}
function inherited(){try{if(process.env.YNX_PROJECT_SERVICES_PIPE!=='8'||!require('node:fs').fstatSync(8).isSocket())throw failure();return client(new(require('node:net').Socket)({fd:8,readable:true,writable:true}));}catch{return {request:async()=>{throw failure();},close(){}};}}
function rpc(caller){const active=new Map();return {async read(id,action,input){if(!UUID.test(id||'')||active.has(id)||active.size>=8||!valid(action,input))throw failure();const controller=new AbortController();active.set(id,controller);try{return await caller.request(action,input,controller.signal);}finally{active.delete(id);}},cancel(id){active.get(id)?.abort();},close(){for(const controller of active.values())controller.abort();active.clear();caller.close();}};}
module.exports={serve,client,inherited,rpc,valid};
