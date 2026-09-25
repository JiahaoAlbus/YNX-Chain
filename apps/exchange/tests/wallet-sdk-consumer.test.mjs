import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createExchangeWallet,PROVIDER_PREFERENCE_KEY,SDK_SOURCE} from '../web/wallet-connect-entry.js';
const account='0x0123456789abcdef0123456789abcdef01234567';
function provider(kind,{missing=false,wrong=false,revoke='success',approve}={}){
  const value=new EventEmitter();value.calls=[];let attempts=0,revoked=false;
  Object.assign(value,{isYNXWallet:kind==='ynx',isMetaMask:kind==='metamask',providerInfo:{rdns:kind==='ynx'?'com.ynx.wallet':'io.metamask'}});
  value.request=async request=>{value.calls.push(request);switch(request.method){
    case 'wallet_switchEthereumChain':if(missing&&attempts++===0)throw Object.assign(new Error('Unknown chain'),{code:4902});return null;
    case 'wallet_addEthereumChain':return null;
    case 'eth_chainId':return wrong?'0x1':'0x1917';
    case 'eth_requestAccounts':return approve?approve():[account];
    case 'eth_accounts':return revoked?[]:[account];
    case 'wallet_revokePermissions':if(revoke==='unsupported')throw Object.assign(new Error('Unsupported'),{code:-32601});if(revoke==='rejected')throw Object.assign(new Error('Rejected'),{code:4001});if(revoke==='false-ack')return true;revoked=true;return null;
    default:throw new Error(`Unexpected method ${request.method}`);
  }};return value;
}
function environment(providers){
  const values=new Map(),scope=Object.assign(new EventTarget(),{Event,ethereum:{providers},location:{origin:'https://exchange.test.invalid'},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}});
  return {scope,values};
}
const methods=value=>value.calls.map(call=>call.method);
test('vendored SDK is byte-exact c97f85e9, no remote runtime imports',()=>{
  const value=readFileSync(new URL('../web/vendor/standard-wallet-browser-c97f85e9.mjs',import.meta.url));
  assert.equal(SDK_SOURCE,'c97f85e9ae4d4580b99860c51738e6040ca9ca18');assert.equal(value.length,22417);assert.equal(createHash('sha256').update(value).digest('hex'),'b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43');assert.doesNotMatch(value.toString(),/^import /m);
});
test('MetaMask selection never requests YNX provider; shared SDK verifies account and chain',async()=>{
  const ynx=provider('ynx'),meta=provider('metamask'),{scope,values}=environment([ynx,meta]),wallet=createExchangeWallet({scope});
  const result=await wallet.connectMetaMask();assert.equal(result.status,'standard-connected');assert.equal(result.providerKind,'metamask');
  assert.deepEqual(methods(meta),['wallet_switchEthereumChain','eth_chainId','eth_requestAccounts','eth_chainId']);assert.deepEqual(ynx.calls,[]);assert.deepEqual([...values],[[PROVIDER_PREFERENCE_KEY,'metamask']]);assert.equal(wallet.state().pendingIntent,null);assert.equal(wallet.state().chooserOpen,false);wallet.disconnect();
});
test('4902 uses the exact Wallet-owned YNX chain metadata before account permission',async()=>{
  const p=provider('ynx',{missing:true}),{scope}=environment([p]),wallet=createExchangeWallet({scope});
  assert.equal((await wallet.connectYNX()).status,'standard-connected');assert.deepEqual(methods(p),['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain','eth_chainId','eth_requestAccounts','eth_chainId']);assert.deepEqual(p.calls[1].params[0],{chainId:'0x1917',chainName:'YNX Testnet',nativeCurrency:{name:'YNX Testnet',symbol:'YNXT',decimals:18},rpcUrls:['https://rpc-testnet.ynxweb4.com','https://evm.ynxweb4.com'],blockExplorerUrls:['https://explorer.ynxweb4.com']});wallet.disconnect();
});
test('explicit Hosted approval uses Wallet-owned adapter and never grants Exchange private order authority',async()=>{
  const {scope,values}=environment([]);scope.location.origin='https://exchange.ynxweb4.com';const calls=[],adapter=new EventEmitter();
  adapter.connected=false;adapter.account=null;
  adapter.connect=()=>{calls.push('connect');adapter.connected=true;adapter.account=account;adapter.emit('accountsChanged',[account]);return Promise.resolve([account])};
  adapter.request=async request=>{calls.push(request.method);return '0x1917'};
  adapter.disconnect=()=>{calls.push('disconnect');adapter.connected=false;adapter.account=null};
  const wallet=createExchangeWallet({scope,createHostedAdapter:()=>adapter});
  const result=await wallet.connectHosted();assert.equal(result.status,'standard-connected');assert.equal(result.transport,'hosted-wallet-web');assert.equal(result.account,account);assert.deepEqual(calls,['connect','eth_chainId']);assert.equal(wallet.state().pendingIntent,null);assert.equal(wallet.state().chooserOpen,false);assert.deepEqual([...values],[],'Hosted approval is not silently restored');
  assert.deepEqual(await wallet.revoke(),{status:'unsupported',permissionRevoked:false,locallyDisconnected:false});
  adapter.emit('accountsChanged',['0x1111111111111111111111111111111111111111']);assert.notEqual(wallet.state().status,'connected');assert.ok(calls.includes('disconnect'));
});
test('Hosted rejection and wrong chain fail closed without touching MetaMask or private authority',async()=>{
  for(const outcome of ['reject','wrong-chain']){
    const {scope}=environment([]);scope.location.origin='https://exchange.ynxweb4.com';const adapter=new EventEmitter();adapter.connected=false;adapter.account=null;adapter.connect=()=>{if(outcome==='reject')return Promise.reject(Object.assign(new Error('Rejected'),{code:'USER_REJECTED'}));adapter.connected=true;adapter.account=account;return Promise.resolve([account])};adapter.request=async()=> '0x1';adapter.disconnect=()=>{adapter.connected=false;adapter.account=null};
    const wallet=createExchangeWallet({scope,createHostedAdapter:()=>adapter});const result=await wallet.connectHosted();assert.notEqual(result.status,'standard-connected');assert.notEqual(wallet.state().status,'connected');wallet.disconnect();
  }
});
test('Installed YNX selection after Hosted approval requests the injected provider, never reuses Hosted transport',async()=>{
  const injected=provider('ynx'),{scope}=environment([injected]);scope.location.origin='https://exchange.ynxweb4.com';const adapter=new EventEmitter();adapter.connected=false;adapter.account=null;
  adapter.connect=async()=>{adapter.connected=true;adapter.account=account;return [account]};adapter.request=async()=> '0x1917';adapter.disconnect=async()=>{adapter.connected=false;adapter.account=null;throw new Error('Hosted teardown rejected')};
  const wallet=createExchangeWallet({scope,createHostedAdapter:()=>adapter});assert.equal((await wallet.connectHosted()).transport,'hosted-wallet-web');
  const result=await wallet.connectYNX();assert.equal(result.status,'standard-connected');assert.equal(result.transport,'injected');assert.deepEqual(methods(injected),['wallet_switchEthereumChain','eth_chainId','eth_requestAccounts','eth_chainId']);wallet.disconnect();
});
test('Hosted pending disconnect, empty account, and wrong chain fence late approval',async()=>{
  for(const event of ['disconnect','accountsChanged','chainChanged']){
    const {scope}=environment([]);scope.location.origin='https://exchange.ynxweb4.com';const adapter=new EventEmitter();let approve;
    adapter.connected=false;adapter.account=null;adapter.connect=()=>new Promise(resolve=>{approve=resolve});adapter.request=async()=> '0x1917';adapter.disconnect=()=>{adapter.connected=false;adapter.account=null};
    const wallet=createExchangeWallet({scope,createHostedAdapter:()=>adapter}),attempt=wallet.connectHosted();
    adapter.emit(event,event==='accountsChanged'?[]:event==='chainChanged'?'0x1':undefined);adapter.connected=true;adapter.account=account;approve([account]);
    const result=await attempt;assert.notEqual(result.status,'standard-connected',event);assert.notEqual(wallet.state().status,'connected',event);wallet.disconnect();
  }
});
test('wrong chain fails before permission; no-provider fallback does not open a page',async()=>{
  const p=provider('ynx',{wrong:true}),{scope}=environment([p]),wallet=createExchangeWallet({scope});assert.equal((await wallet.connectYNX()).status,'wrong-chain');assert.deepEqual(methods(p),['wallet_switchEthereumChain','eth_chainId']);wallet.disconnect();
  const missing=createExchangeWallet({scope:environment([]).scope});assert.equal((await missing.connectMetaMask()).detail,'METAMASK_NOT_INJECTED');
});
test('reload restores only explicitly remembered MetaMask without granting permission',async()=>{
  const ynx=provider('ynx'),meta=provider('metamask'),{scope}=environment([ynx,meta]);
  const first=createExchangeWallet({scope});assert.equal((await first.restore()).status,'not-restored');assert.deepEqual([...ynx.calls,...meta.calls],[]);
  await first.connectMetaMask();meta.calls.length=0;
  const next=createExchangeWallet({scope});assert.equal((await next.restore()).status,'standard-connected');assert.deepEqual(methods(meta),['eth_accounts','eth_chainId']);assert.deepEqual(ynx.calls,[]);next.disconnect();first.disconnect();
});
test('account/chain/disconnect events use SDK state and do not request permissions',async()=>{
  const p=provider('metamask'),{scope}=environment([p]),wallet=createExchangeWallet({scope});await wallet.connectMetaMask();p.calls.length=0;
  p.emit('accountsChanged',['0x1111111111111111111111111111111111111111']);assert.equal(wallet.state().account,'0x1111111111111111111111111111111111111111');
  p.emit('chainChanged','0x1');assert.notEqual(wallet.state().status,'connected');p.emit('chainChanged','0x1917');assert.equal(wallet.state().status,'connected');
  p.emit('accountsChanged',[]);assert.notEqual(wallet.state().status,'connected');assert.deepEqual(p.calls,[]);wallet.disconnect();
});
test('revocation requires SDK ack plus empty readback; unsupported/rejected cannot claim revoked',async()=>{
  for(const outcome of ['success','unsupported','rejected','false-ack']){
    const p=provider('metamask',{revoke:outcome}),{scope,values}=environment([p]),wallet=createExchangeWallet({scope});await wallet.connectMetaMask();p.calls.length=0;
    const result=await wallet.revoke();assert.equal(result.permissionRevoked,outcome==='success');
    if(outcome==='success'){assert.deepEqual(methods(p),['wallet_revokePermissions','eth_accounts']);assert.equal(values.size,0);assert.notEqual(wallet.state().status,'connected')}
    else {assert.deepEqual(methods(p),['wallet_revokePermissions']);assert.equal(wallet.state().status,'connected')}
    wallet.disconnect();
  }
});
test('disconnect fences delayed account approval and removes public provider preference',async()=>{
  let complete,started;const ready=new Promise(resolve=>started=resolve),pending=new Promise(resolve=>complete=resolve);
  const p=provider('metamask',{approve:()=>{started();return pending}}),{scope,values}=environment([p]),wallet=createExchangeWallet({scope});const attempt=wallet.connectMetaMask();await ready;wallet.disconnect();complete([account]);await assert.rejects(attempt);assert.notEqual(wallet.state().status,'connected');assert.equal(values.size,0);
});
test('repeated same-wallet clicks share one explicit approval attempt',async()=>{
  const p=provider('metamask'),{scope}=environment([p]),wallet=createExchangeWallet({scope});
  const first=wallet.connectMetaMask(),second=wallet.connectMetaMask();assert.equal(first,second);await first;assert.equal(methods(p).filter(method=>method==='eth_requestAccounts').length,1);wallet.disconnect();
});
test('SDK rejects malformed accounts and account rejection without storing authority',async()=>{
  for(const approve of [()=>['not-an-account'],()=>{throw Object.assign(new Error('User rejected'),{code:4001})}]){
    const p=provider('metamask',{approve}),{scope,values}=environment([p]),wallet=createExchangeWallet({scope});await assert.rejects(wallet.connectMetaMask());assert.notEqual(wallet.state().status,'connected');assert.equal(values.size,0);wallet.disconnect();
  }
});
test('accepted RPC degradation preserves standard connection and no private session is fabricated',async()=>{
  const p=provider('metamask'),{scope}=environment([p]),wallet=createExchangeWallet({scope});await wallet.connectMetaMask();wallet.reportAcceptedRpcProbe('degraded',4900);assert.equal(wallet.state().status,'connected');assert.equal(wallet.state().account,account);assert.equal(wallet.state().pendingIntent,null);wallet.disconnect();
});
