import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareOriginalCardRuntime} from './protectedStartup.ts';
import {CardStore} from './storage.ts';
import {CardError,type WalletAuthority} from './contracts.ts';

test('private startup refuses missing source before state opening',()=>{
  let opened=0;assert.throws(()=>{prepareOriginalCardRuntime(true,null);opened++},(e:unknown)=>e instanceof CardError&&e.code==='CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE');assert.equal(opened,0);
});
test('public startup does not promote supplied software Wallet authority',async()=>{
  let calls=0;const software:WalletAuthority={async authenticate(){calls++;throw Error('must not call')},async approve(){calls++;throw Error('must not call')}};
  await assert.rejects(prepareOriginalCardRuntime(false,null).bindWallet(software).authenticate({proofHeader:'',operation:'read',method:'GET',path:'/api/card/v1/state',requiredScopes:['account:read']}));assert.equal(calls,0);
});
test('revocation during original authentication cannot release principal',async()=>{
  let current=true;const guard=()=>{if(!current)throw new CardError('CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE',503)};
  const software:WalletAuthority={async authenticate(){current=false;return {owner:'software-owner',chainId:'0x1917',expiresAt:'2099-01-01T00:00:00Z',scopes:['account:read']}},async approve(){throw Error('not called')}};
  await assert.rejects(prepareOriginalCardRuntime(true,guard).bindWallet(software).authenticate({proofHeader:'software-fixture-only',operation:'read',method:'GET',path:'/api/card/v1/state',requiredScopes:['account:read']}),/CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE/);
});
test('late fence refusal rolls back encrypted state and preserves cold original record',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ynx-card-original-runtime-')),path=join(dir,'original.sqlite'),key=new Uint8Array(32).fill(41);let current=true;
  const guard=()=>{if(!current)throw new CardError('CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE',503)},store=new CardStore(path,key,guard);
  try{store.transaction('software-owner',()=>({amount:0,nonce:'original'}),state=>{state.amount=7;return state});assert.throws(()=>store.transaction('software-owner',()=>({amount:0,nonce:'original'}),state=>{state.amount=99;state.nonce='must-not-publish';current=false;return state}),/CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE/)}finally{store.close()}
  const reopened=new CardStore(path,key);try{assert.deepEqual(reopened.read('software-owner',()=>null),{amount:7,nonce:'original'})}finally{reopened.close();key.fill(0);rmSync(dir,{recursive:true,force:true})}
});
