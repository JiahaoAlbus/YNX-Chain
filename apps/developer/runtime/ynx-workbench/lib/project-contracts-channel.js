'use strict';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,LIMIT=160*1024;
const fail=()=>Object.assign(Error('Project Wallet request unavailable; retained references were preserved.'),{code:'IDE_CONTRACT_SERVICE_UNAVAILABLE'});
function valid(action,body){
 if(!body||Object.getPrototypeOf(body)!==Object.prototype)return false;
 const keys=Object.keys(body).sort().join();
 if(['inspect','connect','cancel'].includes(action))return keys==='';
 if(action==='read')return keys==='referenceId'&&UUID.test(body.referenceId||'');
 if(action==='publication-observe')return keys==='requestId'&&UUID.test(body.requestId||'');
 if(action==='publication-preview')return keys==='artifactURI,publishPurpose,targetEnvironment,version'&&typeof body.artifactURI==='string'&&body.artifactURI.length<=4096&&['publishPurpose','targetEnvironment','version'].every(key=>typeof body[key]==='string'&&body[key].length>0&&body[key].length<=256);
 return action==='query'&&keys==='referenceId,refresh'&&UUID.test(body.referenceId||'')&&typeof body.refresh==='boolean';
}
function wire(stream,receive,closed){
 let bytes=Buffer.alloc(0),ended=false;
 const close=()=>{if(ended)return;ended=true;stream.destroy();closed();};
 stream.on('data',chunk=>{try{bytes=Buffer.concat([bytes,Buffer.from(chunk)]);if(bytes.length>LIMIT)throw fail();let pos;while((pos=bytes.indexOf(10))>=0){const line=bytes.subarray(0,pos);bytes=bytes.subarray(pos+1);receive(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line)));}}catch{close();}});
 for(const event of ['close','error','end'])stream.on(event,close);
 return {close,send(value){const line=Buffer.from(JSON.stringify(value)+'\n');if(ended||line.length>LIMIT||stream.writableLength>LIMIT)throw fail();stream.write(line);}};
}
function serve(stream,host){
 let retired=false,last=0;const active=new Set();
 const channel=wire(stream,message=>{
  if(!message||Object.keys(message).sort().join()!=='action,body,id'||!Number.isSafeInteger(message.id)||message.id<=last||!valid(message.action,message.body))throw fail();
  last=message.id;if(active.size>=4){channel.send({id:message.id,ok:false});return;}active.add(message.id);
  Promise.resolve().then(()=>host.call(message.action,message.body)).then(result=>{if(!retired)channel.send({id:message.id,ok:true,result});},()=>{if(!retired)channel.send({id:message.id,ok:false});}).catch(()=>channel.close()).finally(()=>active.delete(message.id));
 },()=>{retired=true;void host.close().catch(()=>{});});
 return channel;
}
function client(stream){
 let sequence=0,retired=false;const pending=new Map();
 const channel=wire(stream,message=>{
  const item=pending.get(message?.id);if(!item||!(message.ok===true&&Object.keys(message).sort().join()==='id,ok,result'||message.ok===false&&Object.keys(message).sort().join()==='id,ok'))throw fail();
  pending.delete(message.id);clearTimeout(item.timer);message.ok?item.resolve(message.result):item.reject(fail());
 },()=>{retired=true;for(const item of pending.values()){clearTimeout(item.timer);item.reject(fail());}pending.clear();});
 return {call(action,body={}){if(retired||pending.size>=4||!valid(action,body))return Promise.reject(fail());return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>channel.close(),action==='connect'?125000:action.startsWith('publication-')?65000:20000);timer.unref?.();pending.set(id,{resolve,reject,timer});try{channel.send({id,action,body});}catch{channel.close();}});},close:channel.close};
}
function inherited(){try{if(process.env.YNX_PROJECT_CONTRACTS_PIPE!=='8'||!require('node:fs').fstatSync(8).isSocket())throw fail();return client(new(require('node:net').Socket)({fd:8,readable:true,writable:true}));}catch{return{call:async()=>{throw fail();},close(){}};}}
function rpc(connection){return {call(action,body){if(!valid(action,body))return Promise.reject(fail());return connection.call(action,body);},close(){connection.close();}};}
module.exports={valid,serve,client,inherited,rpc};
