'use strict';
const {randomUUID}=require('node:crypto');
const LIMIT=3*1024*1024,UUID=/^[a-f0-9-]{36}$/;
const failure=()=>Object.assign(Error('Public Chain connection is unavailable. Existing project data is preserved.'),{code:'chain_public_unavailable'});
function wire(stream,receive,onClose,limit=LIMIT){
 let buffer='',closed=false;
 const close=()=>{if(closed)return;closed=true;stream.destroy();onClose();};
 stream.setEncoding('utf8');stream.on('data',chunk=>{if(closed)return;buffer+=chunk;if(Buffer.byteLength(buffer)>limit)return close();while(buffer.includes('\n')){const pos=buffer.indexOf('\n'),line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);try{receive(JSON.parse(line));}catch{close();return;}}});
 stream.on('error',close);stream.on('close',close);stream.on('end',close);
 return {close,send(value){const line=JSON.stringify(value)+'\n';if(closed||Buffer.byteLength(line)>LIMIT||stream.writableLength>LIMIT)throw failure();stream.write(line);}};
}
function valid(action,params){return ['current','status','compiler','balance','transaction','block'].includes(action)&&Array.isArray(params)&&params.length===(['current','status','compiler'].includes(action)?0:1)&&(!['balance','transaction','block'].includes(action)||typeof params[0]==='string'&&params[0].length<=66);}
function servePublicChain(stream,host){
 let retired=false,count=0,window=Date.now();const active=new Map();
 const channel=wire(stream,message=>{
  if(!message||!UUID.test(message.id||''))throw failure();
  if(Object.keys(message).sort().join() === 'cancel,id'&&message.cancel===true){active.get(message.id)?.abort();return;}
  if(Object.keys(message).sort().join()!=='action,id,params'||!valid(message.action,message.params)||active.has(message.id))throw failure();
  if(Date.now()-window>1000){window=Date.now();count=0;}
  if(active.size>=4||++count>16){channel.send({id:message.id,ok:false});return;}
  const controller=new AbortController();active.set(message.id,controller);
  Promise.resolve().then(()=>{if(retired)throw failure();return host.read(message.action,message.params,controller.signal);}).then(result=>{if(!retired)channel.send({id:message.id,ok:true,result});}).catch(()=>{if(!retired)try{channel.send({id:message.id,ok:false});}catch{channel.close();}}).finally(()=>active.delete(message.id));
 },()=>{retired=true;for(const c of active.values())c.abort();active.clear();host.close();},4096);
 return channel;
}
function publicChainClient(stream){
 let retired=false;const pending=new Map();
 const channel=wire(stream,message=>{
  const item=pending.get(message?.id);if(!item||!(message.ok===true&&Object.keys(message).sort().join()==='id,ok,result'||message.ok===false&&Object.keys(message).sort().join()==='id,ok'))throw failure();
  pending.delete(message.id);item.cleanup();message.ok?item.resolve(message.result):item.reject(failure());
 },()=>{retired=true;for(const p of pending.values()){p.cleanup();p.reject(failure());}pending.clear();});
 return {request(action,params=[],signal){
  if(retired||!valid(action,params)||pending.size>=4)return Promise.reject(failure());
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   const id=randomUUID();let cancelled=false;
   // Keep cancelled IDs until their final response so a late reply cannot
   // retire unrelated active operations or resurrect a cancelled read.
   const abort=()=>{if(cancelled)return;cancelled=true;reject(failure());try{channel.send({id,cancel:true});}catch{channel.close();}};
   const timer=setTimeout(()=>channel.close(),16000);
   pending.set(id,{resolve:value=>{if(!cancelled)resolve(value);},reject,cleanup(){clearTimeout(timer);signal?.removeEventListener('abort',abort);}});
   signal?.addEventListener('abort',abort,{once:true});
   try{channel.send({id,action,params});}catch{channel.close();}
  });
 },close:channel.close};
}
function inheritedPublicChain(){try{if(process.env.YNX_PUBLIC_CHAIN_PIPE!=='5'||!require('node:fs').fstatSync(5).isSocket())throw failure();return publicChainClient(new(require('node:net').Socket)({fd:5,readable:true,writable:true}));}catch{return{request:async()=>{throw failure();},close(){}};}}
function createPublicChainRpc(client){
 const pending=new Map();
 return {async read(id,action,params){if(!UUID.test(id||'')||pending.has(id)||pending.size>=4||!valid(action,params))throw failure();const controller=new AbortController();pending.set(id,controller);try{return await client.request(action,params,controller.signal);}finally{pending.delete(id);}},cancel(id){pending.get(id)?.abort();},close(){for(const c of pending.values())c.abort();pending.clear();client.close();}};
}
module.exports={servePublicChain,publicChainClient,inheritedPublicChain,createPublicChainRpc};
