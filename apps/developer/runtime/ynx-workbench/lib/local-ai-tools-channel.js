"use strict";
const {randomUUID}=require('node:crypto');
const UUID=/^[a-f0-9-]{36}$/, LIMIT=160*1024;
const CODES=new Set(['AI_NOT_SUPPLIED','AI_UNAVAILABLE','AI_INVALID','AI_RETIRED','AI_UNKNOWN']);
const failure=(code='AI_UNAVAILABLE')=>Object.assign(Error(code==='AI_NOT_SUPPLIED'?'The admitted AI service is not supplied. Nothing was sent.':code==='AI_UNKNOWN'?'The remote outcome is unknown. This request will not be resent.':'The AI request is unavailable. Preserve your draft and review again.'),{code:CODES.has(code)?code:'AI_UNAVAILABLE'});
function valid(action,body){
 if(!body||Object.getPrototypeOf(body)!==Object.prototype)return false;
 const keys=Object.keys(body).sort().join();
 if(action==='context')return keys==='';
 if(action==='proposals')return (keys==='context,csrf,prompt'||keys==='context,csrf,mode,prompt'&&body.mode==='selected-edit')&&typeof body.csrf==='string'&&body.csrf.length<=256&&typeof body.prompt==='string'&&body.prompt.trim().length>=4&&Buffer.byteLength(body.prompt)<=4096&&typeof body.context==='string'&&Buffer.byteLength(body.context)<=65536;
 return action==='approve'&&keys==='approval,csrf,proposalId'&&body.approval==='send-reviewed-context-once'&&typeof body.csrf==='string'&&body.csrf.length<=256&&typeof body.proposalId==='string'&&body.proposalId.length<=256;
}
function wire(stream,receive,closed){
 let buffer=Buffer.alloc(0),ended=false;
 function close(){if(ended)return;ended=true;stream.destroy();closed();}
 stream.on('data',chunk=>{try{buffer=Buffer.concat([buffer,Buffer.from(chunk)]);if(buffer.length>LIMIT)throw failure();let pos;while((pos=buffer.indexOf(10))>=0){const line=buffer.subarray(0,pos);buffer=buffer.subarray(pos+1);const text=new TextDecoder('utf-8',{fatal:true}).decode(line);receive(JSON.parse(text));}}catch{close();}});
 for(const event of ['error','close','end'])stream.on(event,close);
 return {close,send(value){const line=Buffer.from(JSON.stringify(value)+'\n');if(ended||line.length>LIMIT||stream.writableLength>LIMIT)throw failure();stream.write(line);}};
}
function serve(stream,host){
 const active=new Map(),seen=new Set();let retired=false;
 const channel=wire(stream,m=>{
  if(!m||!UUID.test(m.id||''))throw failure();
  if(Object.keys(m).sort().join()==='cancel,id'&&m.cancel===true){active.get(m.id)?.abort();return;}
  if(Object.keys(m).sort().join()!=='action,body,id'||!valid(m.action,m.body)||seen.has(m.id)||seen.size>=1024)throw failure('AI_INVALID');
  seen.add(m.id);if(active.size>=4){channel.send({id:m.id,ok:false,code:'AI_UNAVAILABLE'});return;}
  const controller=new AbortController();active.set(m.id,controller);
  Promise.resolve().then(()=>host.call(m.action,m.body,controller.signal)).then(result=>{if(!retired)channel.send({id:m.id,ok:true,result});}).catch(e=>{if(!retired)try{channel.send({id:m.id,ok:false,code:CODES.has(e?.code)?e.code:'AI_UNAVAILABLE'});}catch{channel.close();}}).finally(()=>active.delete(m.id));
 },()=>{retired=true;for(const c of active.values())c.abort();active.clear();host.close();});
 return channel;
}
function client(stream){
 const pending=new Map();let retired=false;
 const channel=wire(stream,m=>{
  const p=pending.get(m?.id);if(!p||!(m.ok===true&&Object.keys(m).sort().join()==='id,ok,result'||m.ok===false&&Object.keys(m).sort().join()==='code,id,ok'&&CODES.has(m.code)))throw failure();
  pending.delete(m.id);p.cleanup();if(!p.cancelled)m.ok?p.resolve(m.result):p.reject(failure(m.code));
 },()=>{retired=true;for(const p of pending.values()){p.cleanup();p.reject(failure(p.action==='approve'?'AI_UNKNOWN':'AI_RETIRED'));}pending.clear();});
 return {request(action,body={},signal){
  if(retired||pending.size>=4||!valid(action,body))return Promise.reject(failure('AI_INVALID'));signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{const id=randomUUID();const p={action,resolve,reject,cancelled:false};
   const abort=()=>{if(p.cancelled)return;p.cancelled=true;reject(failure(action==='approve'?'AI_UNKNOWN':'AI_RETIRED'));try{channel.send({id,cancel:true});}catch{channel.close();}};
   const timer=setTimeout(()=>channel.close(),action==='approve'?120000:15000);timer.unref?.();
   p.cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};pending.set(id,p);signal?.addEventListener('abort',abort,{once:true});
   try{channel.send({id,action,body});if(signal?.aborted)abort();}catch{channel.close();}
  });},close:channel.close};
}
function inherited(){try{if(process.env.YNX_LOCAL_AI_PIPE!=='7'||!require('node:fs').fstatSync(7).isSocket())throw failure();return client(new(require('node:net').Socket)({fd:7,readable:true,writable:true}));}catch{return {request:async()=>{throw failure('AI_NOT_SUPPLIED');},close(){}};}}
function rpc(connection){const active=new Map();return {async call(id,action,body){if(!UUID.test(id||'')||active.has(id)||active.size>=4||!valid(action,body))throw failure('AI_INVALID');const c=new AbortController();active.set(id,c);try{return await connection.request(action,body,c.signal);}finally{active.delete(id);}},cancel(id){active.get(id)?.abort();},close(){for(const c of active.values())c.abort();active.clear();connection.close();}};}
module.exports={valid,failure,serve,client,inherited,rpc};
