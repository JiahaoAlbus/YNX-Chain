import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {feeReview} from '../src/rpc-capabilities.mjs';
import {createReceiveCodeUI} from '../src/receive-code-ui.mjs';
import {NativeWalletService} from '../src/native-wallet-service.mjs';
import {createTransferAttemptUI} from '../src/transfer-attempt-ui.mjs';
import {DIAGNOSTIC_COPY,DIAGNOSTIC_COPY_KEYS} from '../src/wallet-locale-diagnostics.mjs';

test('lock diagnostics distinguish account, blur and fixed deadline without renewing the lease', async()=>{
  let now=10, expire;
  const life=new DesktopKeyLifecycle({now:()=>now,schedule:fn=>(expire=fn,0),unschedule:()=>{},authorizer:{available:()=>true,authenticate:async()=>{},method:'fixture'}});
  life.setFocused(true); life.setAccount('public-A');
  assert.equal(life.status().lockReason,'account-changed');
  assert.equal(life.status().lockedAt,10);
  await life.unlock(); assert.equal(life.status().unlockExpiresAt,120010);
  now=20;life.setFocused(false);
  assert.equal(life.status().lockReason,'focus-lost');assert.equal(life.status().lockedAt,20);
  life.setFocused(true);await life.unlock();now=120020;expire();
  assert.equal(life.status().lockReason,'unlock-expired');
  assert.throws(()=>life.assertUnlocked(),error=>error.data.code==='WALLET_LOCKED');
});

test('fixed native fee copy does not claim extra headroom when maximum equals fee',()=>{
  const model={version:'fixture-native',fullEVM:false,feeWei:'1000000000000000000'};
  const equal=feeReview(model,{gasLimit:25000n,gasPrice:40000000000000n});
  assert.equal(equal.maximumFee,equal.actualFee);
  assert.match(equal.feeExplanation,/equals the fixed native transfer fee/);
  const larger=feeReview(model,{gasLimit:30000n,gasPrice:40000000000000n});
  assert.match(larger.feeExplanation,/includes headroom/);
  assert.throws(()=>feeReview(model,{gasLimit:21000n,gasPrice:40000000000000n}),error=>error.data.code==='RPC_FIXED_FEE_MISMATCH');
});

test('attempt observer failures do not affect delivery and post-sender errors remain unconfirmed',()=>{
  const account='0x'+'3'.repeat(40),service=new NativeWalletService({vault:{},clock:()=>30,onTransferAttempt:()=>{throw Error('observer')}});
  service.pending.set('review',{account});
  const attempt=service.beginTransferAttempt('review','approve');
  assert.equal(service.beginTransferAttempt('review','approve'),null);
  service.transferStage('review','submitting');service.clear();
  service.finishTransferAttempt(attempt,{ok:false,error:{code:'arbitrary-secret-code'}});
  assert.equal(service.transferAttempts(account)[0].state,'result-unconfirmed');
  assert.equal(service.transferAttempts(account)[0].code,'TRANSFER_FAILED');
  service.finishTransferAttempt(attempt,{ok:true,value:{hash:'0x'+'a'.repeat(64)}});
  assert.equal(service.transferAttempts(account)[0].state,'submitted');
  assert.equal(service.transferAttempts(account)[0].hash,'0x'+'a'.repeat(64));
});

test('display rejects foreign and stale attempts, including a late snapshot after a newer event',async()=>{
  let account='0x'+'1'.repeat(40),resolve;
  const node={hidden:true,textContent:''};
  const ui=createTransferAttemptUI({node,getAccount:()=>account,request:()=>new Promise(done=>resolve=done)});
  const record={account,attempt:2,stage:'approval-gate',state:'rejected-before-key-access',code:'WALLET_LOCKED',updatedAt:30};
  const pending=ui.refresh();ui.receive(record);
  resolve({ok:true,value:[{...record,attempt:1,code:'TRANSFER_FAILED'}]});await pending;
  assert.match(node.textContent,/WALLET_LOCKED/);
  ui.receive({...record,attempt:1,code:'TRANSFER_FAILED'});assert.match(node.textContent,/WALLET_LOCKED/);
  account='0x'+'2'.repeat(40);const switched=ui.refresh();
  resolve({ok:true,value:[record]});await switched;
  assert.equal(node.hidden,true);assert.equal(node.textContent,'');
  ui.receive(record);assert.equal(node.hidden,true);
});

test('QR export rechecks closure and key generation after canvas serialization',async()=>{
  const account='ynx1publicfixture',context={open:true,account,keyRevision:1},saved=[];
  const canvas={toDataURL:()=>{context.keyRevision++;return 'data:image/png;base64,AAAA'}};
  const ui=createReceiveCodeUI({canvas,status:{textContent:''},getContext:()=>context,requestCode:async()=>({ok:true,value:{}}),draw:()=>{},savePNG:(...args)=>saved.push(args)});
  await ui.refresh(account);ui.exportPNG();assert.deepEqual(saved,[]);
  await ui.refresh(account);context.open=false;ui.exportPNG();assert.deepEqual(saved,[]);
});

test('all twelve diagnostic locales preserve every interpolation field',()=>{
  assert.equal(Object.keys(DIAGNOSTIC_COPY).length,12);
  for(const dictionary of Object.values(DIAGNOSTIC_COPY))for(const key of DIAGNOSTIC_COPY_KEYS){
    assert.ok(dictionary[key]);
    assert.deepEqual((dictionary[key].match(/\{\w+\}/g)??[]).sort(),(key.match(/\{\w+\}/g)??[]).sort());
  }
});

test('only the currently rendered public receiving canvas can start a PNG download',async()=>{
  const account='ynx1publicfixture',ctx={open:true,account,keyRevision:1},button={disabled:true},saved=[];
  const canvas={hidden:true,toDataURL:()=> 'data:image/png;base64,AAAA'};
  const ui=createReceiveCodeUI({canvas,status:{textContent:''},exportButton:button,getContext:()=>ctx,
    requestCode:async()=>({ok:true,value:{}}),draw:()=>{},savePNG:(...args)=>saved.push(args)});
  assert.equal(typeof ui.exportPNG,'function');
  ui.exportPNG();assert.equal(saved.length,0);
  await ui.refresh(account); assert.equal(button.disabled,false);
  ui.exportPNG();assert.equal(saved.length,1);assert.equal(saved[0][1],`YNX-Testnet-receive-${account}.png`);
  ctx.account='ynx1another';ui.exportPNG();assert.equal(saved.length,1);
  ui.clear();assert.equal(button.disabled,true);ui.exportPNG();assert.equal(saved.length,1);
});

test('approval-gate rejection survives lock clearing without exposing arbitrary error data or message',()=>{
  const account='0x'+'1'.repeat(40),service=new NativeWalletService({vault:{},clock:()=>25});
  service.pending.set('review',{account});
  const attempt=service.beginTransferAttempt('review','approve');
  service.clear();
  service.finishTransferAttempt(attempt,{ok:false,error:{message:'SECRET_DO_NOT_PUBLISH',data:{code:'WALLET_LOCKED',raw:'SECRET_DO_NOT_PUBLISH'}}});
  const record=service.transferAttempts(account)[0];
  assert.equal(record.stage,'approval-gate');assert.equal(record.state,'rejected-before-key-access');
  assert.equal(record.code,'WALLET_LOCKED');assert.equal(record.updatedAt,25);
  assert.equal(JSON.stringify(record).includes('SECRET_DO_NOT_PUBLISH'),false);
  assert.deepEqual(service.transferAttempts('0x'+'2'.repeat(40)),[]);
});
