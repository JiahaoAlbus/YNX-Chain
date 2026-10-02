import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import {p256} from '@noble/curves/nist.js';
import {createProductSessionRequest,encodeProductSessionWalletURL,parseProductSessionReturnURL,evmAddressFromYNX,walletIdentity} from '@ynx-chain/wallet-auth';
import registry from '../vendor/product-session-registry-123016847.json' with {type:'json'};
import {parsePrivateRequest,privateReplayKey,privateProductName,rejectPrivateReturn,signPrivateReturn} from '../src/extension-product-session-v2.js';
import {hostedDynamicCopy} from '../src/hosted-i18n.js';

const source=await readFile(new URL('../src/hosted-wallet-app.js',import.meta.url),'utf8');
const start=source.indexOf('  if (method === "ynx_requestProductSessionV2") {');
const end=source.indexOf('    return signPrivateReturn(request, unlocked.secretHex, new Date(), request.serviceConsent);',start);
assert.ok(start>=0&&end>start);
const branch=source.slice(start,source.indexOf('\n  }',end)+4);
function fixture(decision=true){
  const now=new Date(),secret='1'.padStart(64,'0'),account=evmAddressFromYNX(walletIdentity(secret).account);
  const request=createProductSessionRequest(registry,{productId:'finance',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(Buffer.alloc(32,7),true)).toString('base64url'),scopes:['finance.profile.write'],purpose:'Explicit finite Finance service',nonce:'b'.repeat(43),state:'c'.repeat(43),finiteServiceSeconds:7200},now);
  const context={cancelled:false},events=[],reviews=[];
  const scope=vm.createContext({Date,Intl,parsePrivateRequest,privateReplayKey,privateProductName,rejectPrivateReturn,signPrivateReturn,hostedDynamicCopy,session:{origin:request.origin},vault:{account},context,store:{async consumeReplay(){events.push('replay')}},assertRequestLive(){if(context.cancelled)throw Object.assign(new Error('cancelled'),{code:'HOSTED_APPROVAL_CANCELLED'})},async assertCurrentAccount(){},async unlockEncryptedVault(){events.push('unlock');return{account,secretHex:secret}},async askUser(input){reviews.push(input.detailFactory('en'));events.push('review');return typeof decision==='function'?decision():{approved:decision,password:'fixture-only'}}});
  vm.runInContext(`async function invoke(params){const method="ynx_requestProductSessionV2";${branch}}`,scope);
  return {request,events,reviews,context,run:()=>scope.invoke([encodeProductSessionWalletURL(registry,request,now)])};
}
test('actual Hosted private branch displays both exact deadlines before unlock and signs finite consent',async()=>{
  const f=fixture(),result=await f.run();
  assert.deepEqual(f.events,['replay','review','unlock']);
  assert.ok(f.reviews[0].includes(f.request.expiresAt)&&f.reviews[0].includes(f.request.serviceConsent.expiresAt));
  assert.deepEqual(parseProductSessionReturnURL(registry,f.request,result.returnUrl).approval.serviceConsent,f.request.serviceConsent);
});
test('actual Hosted finite rejection and delayed cancellation never unlock or sign',async()=>{
  const rejected=fixture(false),result=await rejected.run();
  assert.equal(parseProductSessionReturnURL(registry,rejected.request,result.returnUrl).status,'user-rejected');
  assert.deepEqual(rejected.events,['replay','review']);
  let finish;const late=fixture(()=>new Promise(resolve=>{finish=resolve})),pending=late.run();
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  late.context.cancelled=true;finish({approved:true,password:'fixture-only'});
  await assert.rejects(pending,{code:'HOSTED_APPROVAL_CANCELLED'});
  assert.deepEqual(late.events,['replay','review']);
});
