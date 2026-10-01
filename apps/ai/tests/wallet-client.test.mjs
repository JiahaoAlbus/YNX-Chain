import assert from 'node:assert/strict';
import test from 'node:test';
import {AIWalletClient} from '../web/wallet-client.mjs';

const account='0x'+'1'.repeat(40);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function provider(kind){
 const listeners=new Map(),calls=[];
 return {calls,isYNXWallet:kind==='ynx-wallet',isMetaMask:kind==='metamask',
  providerInfo:{rdns:kind==='metamask'?'io.metamask':'com.ynx.wallet'},
  accounts:[account],chain:'0x1917',
  async request(input){calls.push(input);if(input.method==='eth_requestAccounts'||input.method==='eth_accounts')return this.accounts;if(input.method==='eth_chainId')return this.chain;if(input.method==='wallet_switchEthereumChain'){this.chain=input.params[0].chainId;this.emit('chainChanged',this.chain);return null}throw new Error('Unexpected method')},
  on(event,fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn)},
  removeListener(event,fn){listeners.get(event)?.delete(fn)},
  emit(event,value){for(const fn of listeners.get(event)??[])fn(value)},
 };
}
function client(providers,values=new Map()){
 const scope={ethereum:{providers},location:{origin:'https://assistant.ynxweb4.com'}};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 let invalidations=0;
 const instance=new AIWalletClient({scope,storage,waitMs:0,onInvalidated:()=>invalidations++});
 return {instance,values,get invalidations(){return invalidations}};
}

test('discovery is passive and explicit MetaMask selection is independent of YNX injection order',async()=>{
 for(const reverse of [false,true]){
  const ynx=provider('ynx-wallet'),metamask=provider('metamask');
  const c=client(reverse?[metamask,ynx]:[ynx,metamask]);
  await c.instance.restore();assert.equal(ynx.calls.length+metamask.calls.length,0);
  await c.instance.connect('metamask');
  assert.equal(c.instance.state.kind,'metamask');assert.equal(c.instance.state.status,'connected');
  assert.equal(c.instance.state.privateSession,false);assert.equal(ynx.calls.length,0);
  assert.equal(metamask.calls.filter(x=>x.method==='eth_requestAccounts').length,1);
  c.instance.dispose();
 }
});
test('only previously selected wallet is restored through reads, never account requests',async()=>{
 const ynx=provider('ynx-wallet'),metamask=provider('metamask');
 const c=client([ynx,metamask],new Map([['ynx-ai-wallet-choice','ynx-wallet']]));
 await c.instance.restore();
 assert.deepEqual(ynx.calls.map(x=>x.method),['eth_accounts','eth_chainId']);
 assert.equal(metamask.calls.length,0);assert.equal(c.instance.state.kind,'ynx-wallet');
 c.instance.dispose();
});
test('local disconnect survives refresh and does not claim wallet revocation',async()=>{
 const wallet=provider('metamask'),c=client([wallet]);await c.instance.connect('metamask');
 c.instance.disconnect();assert.match(c.instance.state.message,/not revoked/);
 const count=wallet.calls.length;
 const restored=client([wallet],c.values);await restored.instance.restore();
 assert.equal(restored.instance.state.status,'disconnected');assert.equal(wallet.calls.length,count);
 await restored.instance.connect('metamask');assert.equal(restored.instance.state.status,'connected');
 restored.instance.dispose();
});
test('account revocation invalidates AI state and cannot silently reconnect',async()=>{
 const wallet=provider('metamask'),c=client([wallet]);await c.instance.connect('metamask');
 const count=c.invalidations;wallet.accounts=[];wallet.emit('accountsChanged',[]);await tick();
 assert.ok(c.invalidations>count);assert.equal(c.instance.state.account,null);
 assert.equal(c.instance.state.status,'disconnected');
 assert.equal(wallet.calls.filter(x=>x.method==='eth_requestAccounts').length,1);
});
test('network switch occurs only on explicit action and then reads back chain',async()=>{
 const wallet=provider('ynx-wallet');wallet.chain='0x1';const c=client([wallet]);
 await c.instance.connect('ynx-wallet');assert.equal(c.instance.state.status,'wrong-network');
 assert.equal(wallet.calls.some(x=>x.method==='wallet_switchEthereumChain'),false);
 await c.instance.switchNetwork();assert.equal(c.instance.state.chainId,'0x1917');
 c.instance.dispose();
});
test('a rejected wallet can be retried without falling back to the other wallet',async()=>{
 const wallet=provider('metamask'),ynx=provider('ynx-wallet'),request=wallet.request;
 wallet.request=async()=>{throw Object.assign(new Error('declined'),{code:4001})};
 const c=client([wallet,ynx]);await c.instance.connect('metamask');
 assert.equal(c.instance.state.status,'unavailable');assert.equal(ynx.calls.length,0);
 wallet.request=request;await c.instance.connect('metamask');assert.equal(c.instance.state.status,'connected');
 c.instance.dispose();
});
test('ambiguous wallet candidates never trigger automatic account access',async()=>{
 const first=provider('metamask'),second=provider('metamask'),c=client([first,second]);
 await c.instance.connect('metamask');assert.equal(c.instance.state.status,'unavailable');
 assert.equal(first.calls.length+second.calls.length,0);
});
test('disconnect while account request is pending discards late connection',async()=>{
 const wallet=provider('metamask');let finish;
 wallet.request=async({method})=>method==='eth_requestAccounts'?new Promise(resolve=>{finish=resolve}):'0x1917';
 const c=client([wallet]);const pending=c.instance.connect('metamask');await tick();
 c.instance.disconnect();finish([account]);await pending;
 assert.equal(c.instance.state.status,'disconnected');assert.equal(c.instance.state.account,null);
});

test('missing provider, rejection and transport loss never report confirmed identity change',async()=>{
 const empty=client([]);await empty.instance.connect('ynx-wallet');assert.equal(empty.invalidations,0);
 const wallet=provider('ynx-wallet'),c=client([wallet]);await c.instance.connect('ynx-wallet');assert.equal(c.invalidations,0);
 wallet.emit('disconnect',{code:4900});assert.equal(c.invalidations,0);assert.equal(c.instance.state.status,'transport-unavailable');assert.equal(c.instance.state.account,account);
 c.instance.dispose();
});
test('only a confirmed different account generates account-changed; chain changes do not',async()=>{
 const wallet=provider('ynx-wallet'),c=client([wallet]);await c.instance.connect('ynx-wallet');const reasons=[];c.instance.onInvalidated=value=>reasons.push(value.reason);
 wallet.chain='0x1';wallet.emit('chainChanged','0x1');await tick();assert.deepEqual(reasons,[]);
 wallet.accounts=['0x'+'2'.repeat(40)];wallet.emit('accountsChanged',wallet.accounts);await tick();assert.ok(reasons.every(reason=>reason==='account-changed'));assert.ok(reasons.length>0);c.instance.dispose();
});
test('phone cancellation discards a late approved provider without requesting AI permission',async()=>{
 const wallet=provider('ynx-wallet');let resolveConnect;const phone={on(){},connect(){return new Promise(resolve=>{resolveConnect=resolve})},async cancel(){}};
 const c=client([]);c.instance.loadSDK=async()=>({WalletConnectDAppConnection:class{constructor(){return phone}},toDataURL:async()=>''});
 const pending=c.instance.connectPair();await tick();await c.instance.cancelPair();resolveConnect(wallet);await pending;
 assert.equal(c.instance.state.status,'disconnected');assert.equal(c.invalidations,0);assert.equal(wallet.calls.length,0);
});
test('private transport uses the selected YNX provider, never MetaMask or a standard signing fallback',async()=>{
 const wallet=provider('ynx-wallet'),metamask=provider('metamask'),c=client([wallet,metamask]);await c.instance.connect('metamask');
 await assert.rejects(c.instance.requestProductSessionV2('ynxwallet://authorize?request=x'),/UNAVAILABLE/);
 await c.instance.connect('ynx-wallet');const request=wallet.request;wallet.request=async input=>input.method==='ynx_requestProductSessionV2'?{version:2,returnUrl:'https://assistant.ynxweb4.com/wallet-auth/callback?result=approved'}:request.call(wallet,input);
 const result=await c.instance.requestProductSessionV2('ynxwallet://authorize?request=official');assert.equal(result.version,2);assert.equal(metamask.calls.some(call=>call.method==='personal_sign'),false);c.instance.dispose();
});
