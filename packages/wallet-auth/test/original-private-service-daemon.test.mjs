import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

function bounded(promise,ms,label){
 let timer;return Promise.race([promise,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]).finally(()=>clearTimeout(timer));
}
test('actual daemon normal startup reports unconfigured private Source and cleans up without a fabricated Native owner',{timeout:12000},async()=>{
 const directory=mkdtempSync(join(tmpdir(),'ynx-private-daemon-no-source-')),probe=createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 // Only this test's isolated empty state and temporary HTTP port are selected.
 // Original release/runtime selections stay unchanged and unconfigured. No
 // protected profile/key, real wallet data or Source issuer is supplied/read.
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('YNX_')&&!['NODE_OPTIONS','NODE_PATH'].includes(key)));
 Object.assign(env,{ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'',NODE_PATH:'',YNX_WALLET_GATEWAY_HTTP_ADDR:'127.0.0.1',YNX_WALLET_GATEWAY_HTTP_PORT:String(port),YNX_WALLET_GATEWAY_STATE_PATH:join(directory,'gateway.json'),YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH:join(directory,'product.json'),YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION:'2'});
 const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/ynx-wallet-gatewayd.mjs',import.meta.url))],{env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',buffer='',listeningResolve,listeningReject;const events=[];
 const listening=new Promise((resolve,reject)=>{listeningResolve=resolve;listeningReject=reject;});
 child.stdout.on('data',bytes=>{const text=bytes.toString();stdout+=text;buffer+=text;for(;;){const index=buffer.indexOf('\n');if(index<0)break;const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let event;try{event=JSON.parse(line);}catch{continue;}events.push(event);if(event.event==='listening')listeningResolve(event);}});
 child.stderr.on('data',bytes=>{stderr+=bytes.toString();});child.once('error',listeningReject);
 const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{listeningReject(Error('Daemon exited before readiness: '+code+' '+stderr));resolve({code,signal});});});
 try{
  await bounded(listening,5000,'Daemon startup did not finish');
  const unavailable=events.find(event=>event.event==='original_private_service_unavailable');assert(unavailable);assert.equal(unavailable.code,'ORIGINAL_RUNTIME_NOT_CONFIGURED');
  child.kill('SIGTERM');const result=await bounded(exit,5000,'Original shutdown failed to drain');assert.equal(result.signal,null);assert.equal(result.code,1);
  const shutdown=events.find(event=>event.event==='shutdown_incomplete');assert(shutdown);assert.equal(shutdown.privateTerminalUnknown,false);assert.equal(shutdown.observerCleanupFailurePresent,false);assert.equal(shutdown.httpStopFailurePresent,false);
  assert.equal(readdirSync(directory).some(name=>name.includes('private-terminal')),false);
  console.log('ACTUAL_DAEMON_ENTRY_AND_SIGTERM_UNCONFIGURED_SOURCE_REFUSED; Native owner/grant/installed session=false');
 }finally{
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await bounded(exit,1000,'Test child did not stop').catch(()=>{});}
  if(process.env.YNX_QA_DAEMON_LOG)writeFileSync(process.env.YNX_QA_DAEMON_LOG,JSON.stringify({classification:'ACTUAL_DAEMON_TEMP_STATE_NO_NATIVE_QUALIFICATION',stdout,stderr,events},null,2)+'\n',{flag:'wx'});
  rmSync(directory,{recursive:true,force:true});
 }
});
