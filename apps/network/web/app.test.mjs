import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const A='0x'+'a'.repeat(64), B='0x'+'b'.repeat(64);
function environment(){
 const nodes=new Map(),handlers=new Map(),pending=[];
 function element(id){if(!nodes.has(id)){const classes=new Set();nodes.set(id,{value:'',hidden:false,disabled:false,textContent:'',className:'',files:[],classList:{toggle(c,on){if(on)classes.add(c);else classes.delete(c);},remove(...cs){cs.forEach(c=>classes.delete(c));}},addEventListener(type,fn){handlers.set(id+':'+type,fn);}});}return nodes.get(id);}
 const rows=Array.from({length:4},(_,i)=>({...element('row'+i),querySelector(){return element('status'+i);}}));
 element('tx-id').value=A;
 const storage=new Map([['ynxNetworkTicket','ticket']]);
 const response=(body,status=200)=>({ok:status===200,status,json:async()=>body});
 const fetch=(path,options)=>path==='/api/status'?Promise.resolve(response({anchorConfigured:false})):new Promise(resolve=>pending.push({path,options,resolve:(value,status)=>resolve(response(value,status))}));
 runInNewContext(source,{document:{getElementById:element,querySelectorAll:()=>rows},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},navigator:{},fetch,console});
 return {node:element,rows,pending,emit:(id,type)=>handlers.get(id+':'+type)({preventDefault(){},target:element(id)})};
}
const view=(txId,level='INCLUSION_VERIFIED')=>({txId,level,source:'fixture',height:'12',detail:'fixture only'});
async function settle(){await Promise.resolve();await Promise.resolve();}

test('T-P09-02 tx edits and failed replacement never display old verified evidence',async()=>{
 const e=environment();await settle();
 const first=e.emit('lookup-form','submit');
 e.pending.shift().resolve({view:view(A),report:{}});await first;
 assert.equal(e.node('level-tag').textContent,'INCLUSION_VERIFIED');assert.equal(e.node('meta-tx').textContent,A);
 e.node('tx-id').value=B;e.emit('tx-id','input');
 assert.equal(e.node('level-tag').textContent,'尚未查询');assert.equal(e.node('evidence-meta').hidden,true);
 const second=e.emit('lookup-form','submit');e.pending.shift().resolve({error:'RPC_HTTP_ERROR'},502);await second;
 assert.equal(e.node('level-tag').textContent,'尚未查询');assert.equal(e.node('meta-tx').textContent,'');assert.equal(e.node('raw-panel').hidden,true);
});
test('T-P09-02 late response for changed tx and older request cannot replace current evidence',async()=>{
 const e=environment();await settle();const old=e.emit('lookup-form','submit');const oldResponse=e.pending.shift();
 e.node('tx-id').value=B;e.emit('tx-id','input');const current=e.emit('lookup-form','submit');e.pending.shift().resolve({view:view(B,'RPC_ONLY'),report:{}});await current;
 oldResponse.resolve({view:view(A),report:{}});await old;
 assert.equal(e.node('meta-tx').textContent,B);assert.equal(e.node('level-tag').textContent,'RPC_ONLY');
 const same1=e.emit('lookup-form','submit'),sameOld=e.pending.shift();const same2=e.emit('lookup-form','submit');e.pending.shift().resolve({view:view(B,'RPC_ONLY'),report:{}});await same2;sameOld.resolve({view:view(B),report:{}});await same1;
 assert.equal(e.node('level-tag').textContent,'RPC_ONLY');
});
test('T-P09-02 proof response must bind requested tx and failed import clears prior proof',async()=>{
 const e=environment();await settle();e.node('proof-file').files=[{name:'proof.json',size:10,text:async()=>'{"source":"fixture"}'}];
 const job=e.emit('proof-file','change');await settle();e.pending.shift().resolve(view(B));await job;
 assert.equal(e.node('evidence-meta').hidden,true);assert.match(e.node('notice').textContent,/RECEIPT_TX_MISMATCH/);
 const first=e.emit('lookup-form','submit');e.pending.shift().resolve({view:view(A),report:{}});await first;
 e.node('proof-file').files=[{name:'broken.json',size:5,text:async()=>'{bad'}];await e.emit('proof-file','change');
 assert.equal(e.node('level-tag').textContent,'尚未查询');assert.equal(e.node('raw-report').textContent,'');
});
test('T-P09-03 revoke and expired pairing invalidate in-flight evidence',async()=>{
 const e=environment();await settle();const old=e.emit('lookup-form','submit'),response=e.pending.shift();const revoke=e.emit('revoke','click');e.pending.shift().resolve({revoked:true});await revoke;
 response.resolve({view:view(A),report:{}});await old;
 assert.equal(e.node('evidence-meta').hidden,true);assert.equal(e.node('lookup-button').disabled,true);assert.equal(e.node('level-tag').textContent,'尚未查询');
 const e2=environment();await settle();const job=e2.emit('lookup-form','submit');e2.pending.shift().resolve({error:'PAIRING_REQUIRED'},401);await job;
 assert.equal(e2.node('evidence-meta').hidden,true);assert.equal(e2.node('lookup-button').disabled,true);assert.match(e2.node('pair-state').textContent,/过期/);
});
