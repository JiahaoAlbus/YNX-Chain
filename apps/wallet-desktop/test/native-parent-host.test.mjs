import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {EventEmitter} from 'node:events';
const source=process.env.HOST_SOURCE??new URL('../src/',import.meta.url).pathname;
function publicStream(onDestroy=()=>{}){const stream=new EventEmitter();stream.destroy=()=>{if(stream.destroyed)return;stream.destroyed=true;onDestroy();queueMicrotask(()=>{stream.closed=true;stream.emit('close');});};return stream;}
// PUBLIC-only lexical resource controls. Never loads Native or creates a
// registered source, real joint, account, OS child, descriptor or grant.
function api(file,dependencies={}){const text=readFileSync(source+'/'+file,'utf8'),names=[...text.matchAll(/export (?:async )?function (\w+)/g)].map(x=>x[1]),context={Buffer,setTimeout,clearTimeout,...dependencies};runInNewContext(text.replace(/^import .*;$/mg,'').replaceAll('export ','')+'\nthis.api={'+names.join(',')+'};this.api.publicClone=value=>JSON.parse(JSON.stringify(value));',context);return context.api;}
function fixture({beginHook,joinCause,readCause}={}){
 const a=api('original-admission-parent-source.mjs'),events=[];let finish,locked=false,closeCount=0;
 const executor={executable:'/PUBLIC/NO_EXECUTION',args:[],applicationId:'PUBLIC',consumerManifestDigest:'PUBLIC',instanceId:'PUBLIC',currentReference:'PUBLIC-ref',expiresAtMs:2000};
 const host={assertCurrent(){if(locked)throw Error('PUBLIC_LOCKED');},readPending(){events.push('read');if(readCause)throw readCause;return {pending:true,descriptor:41,currentReference:'PUBLIC-ref',requestNonce:'PUBLIC-nonce'};},beginPrelude(){events.push('begin');beginHook?.(()=>{locked=true;});return new Promise(resolve=>{finish=resolve;});},takeSenderDescriptor(){events.push('take');return 42;},readInstalledFrame(){throw Error('PUBLIC_NO_FRAME');},acknowledge(){throw Error('PUBLIC_NO_ACK');},retire(){events.push('retire');finish?.();},async join(){events.push('join');if(joinCause!==undefined)throw joinCause;},async close(){events.push('close');closeCount++;},outcome(){return {PUBLIC:true};}};
 const check=()=>{if(locked)throw Error('PUBLIC_LOCKED');};
 a.bindOriginalAdmissionParentSelection(check,{vault:{PUBLIC:true},raw:{expiresAtMs:2000,expectedRequest:{...executor,requestNonce:'PUBLIC-nonce'}},executor,assertCurrent:check,originalConfiguration:{reserveParentHost(){events.push('reserve');return host;}}});
 const ref=a.acquireOriginalAdmissionParentSource(check,executor,JSON.stringify,()=>1000,()=>undefined);
 const child={stdio:[null,null,null,null,{destroy(){throw Error('BORROWED_FD_WRAPPED');}}]};
 return {a,ref,events,host,child,finish:()=>finish?.(),closeCount:()=>closeCount};
}
test('begin enters before spawn, borrowed fd4 is never a pipe or a JS Socket',async()=>{
 const f=fixture();let options;
 f.a.enterOriginalAdmissionParentLaunch(f.ref,(_e,_a,o)=>{options=o;f.events.push('spawn');f.finish();return f.child;});
 assert.equal(options.stdio[4],41);assert.deepEqual(f.events.slice(0,4),['reserve','read','begin','spawn']);
 await f.a.waitOriginalAdmissionParentPrelude(f.ref);
 const closed=[],stream=publicStream(()=>closed.push('stream'));
 assert.equal(f.a.takeOriginalAdmissionParentStream(f.ref,fd=>{assert.equal(fd,42);return stream;},fd=>closed.push(fd)),stream);
 await f.a.closeOriginalAdmissionParentSource(f.ref);
 assert.deepEqual(closed,['stream']);assert.equal(f.closeCount(),1);
});
test('cancel during synchronous begin prevents any spawn and drains the same partial owner',async()=>{
 const f=fixture({beginHook:lock=>lock()});let spawned=0;
 assert.throws(()=>f.a.enterOriginalAdmissionParentLaunch(f.ref,()=>{spawned++;return f.child;}),/PUBLIC_LOCKED/);
 await f.a.closeOriginalAdmissionParentSource(f.ref);assert.equal(spawned,0);assert.equal(f.closeCount(),1);
});
test('socket constructor failure closes only the transferred duplicate once',async()=>{
 const f=fixture();f.a.enterOriginalAdmissionParentLaunch(f.ref,()=>{f.finish();return f.child;});await f.a.waitOriginalAdmissionParentPrelude(f.ref);
 const closed=[];assert.throws(()=>f.a.takeOriginalAdmissionParentStream(f.ref,fd=>{assert.equal(fd,42);throw false;},fd=>closed.push(fd)),e=>e===false);
 const close=f.a.closeOriginalAdmissionParentSource(f.ref);await close;assert.equal(f.a.closeOriginalAdmissionParentSource(f.ref),close);assert.deepEqual(closed,[42]);assert.equal(f.closeCount(),1);
 f.a.selectOriginalAdmissionParentOutcome(f.ref,s=>{assert.equal(s.firstCause,false);assert.equal(s.child,f.child);});
});
test('native join failure still attempts native close and retains first falsy cleanup debt',async()=>{
 const f=fixture({joinCause:false});f.a.enterOriginalAdmissionParentLaunch(f.ref,()=>{f.finish();return f.child;});await f.a.waitOriginalAdmissionParentPrelude(f.ref);
 const close=f.a.closeOriginalAdmissionParentSource(f.ref);let rejected=false;try{await close;}catch(e){rejected=true;assert.equal(e,false);}
 assert.equal(rejected,true);assert.equal(f.closeCount(),1);assert.equal(f.a.closeOriginalAdmissionParentSource(f.ref),close);
 f.a.selectOriginalAdmissionParentOutcome(f.ref,s=>{assert.equal(s.cleanupCause,false);assert.equal(s.closed,false);});
});
test('R69 same close pass remains reserved across real Host channel retirement reentry',async()=>{
 const f=fixture();f.a.enterOriginalAdmissionParentLaunch(f.ref,()=>{f.finish();return f.child;});await f.a.waitOriginalAdmissionParentPrelude(f.ref);
 f.a.takeOriginalAdmissionParentStream(f.ref,()=>publicStream(),()=>{});let inner,count=0;
 f.a.attachOriginalAdmissionParentChannel(f.ref,{close(){count++;inner=f.a.closeOriginalAdmissionParentSource(f.ref);}});
 const outer=f.a.closeOriginalAdmissionParentSource(f.ref);await outer;assert.equal(inner,outer);assert.equal(count,1);assert.equal(f.closeCount(),1);
});
test('native partial reservation is captured and closed even when its first read fails',async()=>{
 const cause=Error('PUBLIC_PARTIAL_READ'),f=fixture({readCause:cause});let spawned=0;
 assert.throws(()=>f.a.enterOriginalAdmissionParentLaunch(f.ref,()=>{spawned++;return f.child;}),e=>e===cause);
 const close=f.a.closeOriginalAdmissionParentSource(f.ref);await close;
 assert.equal(spawned,0);assert.equal(f.closeCount(),1);
 f.a.selectOriginalAdmissionParentOutcome(f.ref,s=>{assert.equal(s.firstCause,cause);assert.equal(s.launchEntered,true);});
 assert.throws(()=>f.a.enterOriginalAdmissionParentLaunch(f.ref,()=>{}),/RETIRED/);
});
test('parent cleanup waits for the transferred Socket physical close event',async()=>{
 const f=fixture();f.a.enterOriginalAdmissionParentLaunch(f.ref,()=>{f.finish();return f.child;});await f.a.waitOriginalAdmissionParentPrelude(f.ref);
 const stream=new EventEmitter();stream.destroy=()=>{stream.destroyed=true;};f.a.takeOriginalAdmissionParentStream(f.ref,()=>stream,()=>{});
 const close=f.a.closeOriginalAdmissionParentSource(f.ref);let done=false;void close.then(()=>{done=true;});
 await Promise.resolve();await Promise.resolve();assert.equal(done,false);assert.equal(f.closeCount(),0);
 stream.closed=true;stream.emit('close');await close;assert.equal(f.closeCount(),1);
});
test('borrowed fd metadata mismatch prevents prelude and spawn while closing partial Host',async()=>{
 const f=fixture();f.host.readPending=()=>({pending:true,descriptor:41,currentReference:'PUBLIC-WRONG',requestNonce:'PUBLIC-nonce'});let spawned=0;
 assert.throws(()=>f.a.enterOriginalAdmissionParentLaunch(f.ref,()=>{spawned++;return f.child;}),/BINDING_CHANGED/);
 await f.a.closeOriginalAdmissionParentSource(f.ref);assert.equal(spawned,0);assert.equal(f.events.includes('begin'),false);assert.equal(f.closeCount(),1);
});
test('explicit undefined parent retirement remains distinct from an omitted cancellation cause',async()=>{
 const f=fixture();
 f.a.retireOriginalAdmissionParentSource(f.ref,undefined);await f.a.closeOriginalAdmissionParentSource(f.ref);
 f.a.selectOriginalAdmissionParentOutcome(f.ref,s=>{assert.equal(s.firstCausePresent,true);assert.equal(s.firstCause,undefined);});
});
test('actual launch caller drives prelude/spawn/take and its close waits for both SDK and Socket',async()=>{
 const parent=api('original-admission-parent-source.mjs'),events=[],stream=publicStream(()=>events.push('socket-close')),child=new EventEmitter();let resolve,closes=0;
 child.stdio=[null,null,null,null,null]; // Numeric spawn fd creates no JS pipe.
 const a=api('original-admission-broker.mjs',{...parent,Socket:function(options){assert.equal(options.fd,42);events.push('socket');return stream;},closeSync(){throw Error('PUBLIC_BORROWED_CLOSE_FORBIDDEN');}});
 const p=a.publicClone(publication()),r=p.selection.expectedRequest,executor=a.publicClone({executable:'/PUBLIC/NO_EXECUTION',args:[],applicationId:r.applicationId,consumerManifestDigest:r.consumerManifestDigest,instanceId:r.instanceId,currentReference:r.currentReference,expiresAtMs:2000}),check=()=>undefined;
 const host={assertCurrent(){},readPending(){events.push('read');return {pending:true,descriptor:41,currentReference:r.currentReference,requestNonce:r.requestNonce};},beginPrelude(){events.push('begin');return new Promise(yes=>{resolve=yes;});},takeSenderDescriptor(){events.push('take');return 42;},readInstalledFrame(){throw Error('PUBLIC_NO_FRAME');},acknowledge(){throw Error('PUBLIC_NO_ACK');},retire(){events.push('retire');resolve?.();},async join(){events.push('join');},async close(){closes++;events.push('close');},outcome:()=>({PUBLIC:true})};
 parent.bindOriginalAdmissionParentSelection(check,{vault:{PUBLIC:true},raw:{expiresAtMs:2500,expectedRequest:r},executor,assertCurrent:check,originalConfiguration:{reserveParentHost(){events.push('reserve');return host;}}});
 const channel=await a.launchOriginalAdmissionIDE({executor,assertExecutorCurrent:check,assertCustodyCurrent:check,now:()=>1000,schedule:()=>({}),unschedule:()=>{},spawn(_e,_a,options){assert.equal(options.stdio[4],41);events.push('spawn');queueMicrotask(()=>{child.emit('spawn');resolve();});return child;}});
 assert.deepEqual(events.slice(0,6),['reserve','read','begin','spawn','take','socket']);channel.close(Error('PUBLIC_STOP'));await channel.joinEntered();assert.equal(stream.closed,true);assert.equal(closes,1);
 let retained=0;a.selectRetainedOriginalAdmissionLaunches(()=>retained++);assert.equal(retained,0);
});
function publication(){const hex='a'.repeat(64);return {account:'PUBLIC-ACCOUNT',sequence:1,expiresAtMs:2000,selection:{sourceSelection:{rootPath:'/PUBLIC/root',rootDigest:hex,rolePath:'/PUBLIC/role',roleDigest:hex},receiptSelection:{receiptPath:'/PUBLIC/receipts/'+ 'x'.repeat(43)+'.admission.json',receiptDigest:hex},receiptDirectory:'/PUBLIC/receipts',expectedRequest:{version:1,purpose:'wallet-product-session-v2-service-admission/v1',service:'wallet-product-session-v2',productId:'developer',platform:'macos',applicationId:'com.ynxweb4.developer.testnetpreview',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:hex,consumerManifestDigest:hex,gatewayManifestDigest:hex,instanceId:'PUBLIC',currentReference:hex,operations:['beginYNX','handleReturn','restore','disconnect'],requestNonce:'x'.repeat(43),requestedAtMs:900,expiresAtMs:2000}}};}
function brokerFixture({mismatch=false,cause=Error('PUBLIC_NO_NATIVE_ACCEPTANCE')}={}){
 const a=api('original-admission-broker.mjs'),p=a.publicClone(publication()),s=new EventEmitter(),writes=[],acks=[];
 s.write=(wire,callback)=>{writes.push(wire);callback();};s.destroy=()=>{};
 // Native NSJSON property order is not canonical JS order. Forward raw bytes.
 const frame=Buffer.from(JSON.stringify({selection:p.selection,type:'installed',sequence:mismatch?2:p.sequence,expiresAtMs:p.expiresAtMs})+'\n');
 const broker=a.createOriginalAdmissionBroker({stream:s,assertChannelCurrent:()=>undefined,readInstalledFrame:()=>frame,acknowledge:raw=>{acks.push(raw);throw cause;},now:()=>1000,schedule:()=>({}),unschedule:()=>{}});
 const ack=Buffer.from(a.admissionCanonical(a.publicClone({type:'ack',requestNonce:p.selection.expectedRequest.requestNonce,receiptDigest:p.selection.receiptSelection.receiptDigest,sequence:p.sequence,consumerManifestDigest:p.selection.expectedRequest.consumerManifestDigest}))+'\n');
 return {a,p,s,writes,acks,frame,broker,ack};
}
test('actual Native frame Buffer is forwarded unchanged and original ACK bytes reach Native refusal',async()=>{
 const f=brokerFixture();const result=f.broker.deliver(f.p);assert.equal(f.writes[0],f.frame);f.s.emit('data',f.ack);await assert.rejects(result,/PUBLIC_NO_NATIVE_ACCEPTANCE/);assert.equal(f.acks.length,1);assert.deepEqual(f.acks[0],f.ack.subarray(0,-1));
});
test('Native sequence mismatch fails closed without rebuilding or writing an installed frame',async()=>{
 const f=brokerFixture({mismatch:true});await assert.rejects(f.broker.deliver(f.p),/BINDING_CHANGED/);assert.equal(f.writes.length,0);f.broker.close();
});
test('explicit undefined Native ACK refusal remains the original rejected outcome',async()=>{
 const f=brokerFixture();let calls=0;
 f.broker.close();
 // Rebuild only the PUBLIC stream control, never a real Source/authority.
 const broker=f.a.createOriginalAdmissionBroker({stream:f.s,assertChannelCurrent:()=>undefined,readInstalledFrame:()=>f.frame,acknowledge(){calls++;throw undefined;},now:()=>1000,schedule:()=>({}),unschedule:()=>{}});
 const result=broker.deliver(f.p);f.s.emit('data',f.ack);let rejected=false;try{await result;}catch(e){rejected=true;assert.equal(e,undefined);}assert.equal(rejected,true);assert.equal(calls,1);f.broker.close();
});
test('EOF is not write completion: cleanup joins the actual entered write callback',async()=>{
 const f=brokerFixture();f.broker.close();let complete;
 f.s.write=(wire,callback)=>{complete=callback;};
 const broker=f.a.createOriginalAdmissionBroker({stream:f.s,assertChannelCurrent:()=>undefined,readInstalledFrame:()=>f.frame,acknowledge(){throw Error('PUBLIC_NO_ACK');},now:()=>1000,schedule:()=>({}),unschedule:()=>{}});
 const result=broker.deliver(f.p);broker.close(Error('PUBLIC_CANCELLED'));await assert.rejects(result,/PUBLIC_CANCELLED/);
 let joined=false;const drain=broker.joinEntered().then(()=>{joined=true;});await Promise.resolve();assert.equal(joined,false);complete();await drain;assert.equal(joined,true);
});
test('absolute deadline cancels a pending original write without renewing or retrying it',async()=>{
 const f=brokerFixture();f.broker.close();let time=1000,complete,writes=0;const timers=[];
 f.s.write=(_wire,callback)=>{writes++;complete=callback;};
 const broker=f.a.createOriginalAdmissionBroker({stream:f.s,assertChannelCurrent:()=>undefined,readInstalledFrame:()=>f.frame,acknowledge(){throw Error('PUBLIC_NO_ACK');},now:()=>time,schedule(fn){timers.push(fn);return fn;},unschedule:()=>{}});
 const result=broker.deliver(f.p);time=2000;for(const timer of timers)timer();await assert.rejects(result,/EXPIRED|TIMEOUT/);complete();await broker.joinEntered();assert.equal(writes,1);
});
