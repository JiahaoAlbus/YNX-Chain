import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeWalletService} from '../src/native-wallet-service.mjs';
const account='0x'+'11'.repeat(20),to='0x'+'22'.repeat(20);
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function fixture(blockAt){
 const entered=deferred(),release=deferred();let first=true,prepares=0;
 const hold=async name=>{if(name===blockAt&&first){first=false;entered.resolve();await release.promise;}};
 const caps={enabled:true,fullEVM:true,unit:'wei'};
 const service=new NativeWalletService({vault:{status:async()=>({initialized:true,account}),authorization:{current:()=>({assert(){}})}},network:{capabilities:async()=>{await hold('capabilities');return caps;},balance:async()=>{await hold('balance');return '100000000000000000000';}},sender:{prepare:async(_account,tx)=>{prepares++;await hold('sender');return Object.freeze({...tx,gasLimit:'0x5208',gasPrice:'0x1'});}},requestId:(()=>{let n=0;return()=>String(++n);})()});
 return{service,entered,release,prepares:()=>prepares};
}
for(const stage of ['capabilities','balance','sender'])test(`clear invalidates in-flight preview at ${stage} without repopulating pending`,async()=>{
 const f=fixture(stage),p=f.service.prepareTransfer({to,amount:'1'});
 const rejected=assert.rejects(p,e=>e.data?.code==='WALLET_OPERATION_CANCELLED');
 await f.entered.promise;f.service.clear();f.release.resolve();await rejected;
 assert.equal(f.service.pending.size,0);
 if(stage!=='sender')assert.equal(f.prepares(),0);
});
test('older preparation cannot replace a newer completed review',async()=>{
 const f=fixture('capabilities'),old=f.service.prepareTransfer({to,amount:'1'});
 const rejected=assert.rejects(old,e=>e.data?.code==='WALLET_OPERATION_CANCELLED');
 await f.entered.promise;const newer=await f.service.prepareTransfer({to,amount:'2'});
 f.release.resolve();await rejected;
 assert.equal(f.service.pending.size,1);assert.equal(f.service.pending.get(newer.id).transaction.value,'0x1bc16d674ec80000');
});
