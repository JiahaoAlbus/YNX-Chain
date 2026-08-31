import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {restoreStandardWallet,watchStandardWallet,type EIP1193Provider} from './wallet';

const wallet=readFileSync(new URL('./wallet.ts',import.meta.url),'utf8');
const manifest=readFileSync(new URL('../contract/public-endpoint-manifest.json',import.meta.url),'utf8');

test('mobile consumes the accepted standard wallet SDK and never creates a device proof',()=>{
  assert.ok(wallet.includes("@ynx/dapp-connect-sdk"));
  assert.ok(wallet.includes('StandardWalletConnection'));
  for(const prohibited of ['p256','createGatewayChallenge','signGatewayChallenge','createProductSessionProof','sessions/complete','encodeRequestDeepLink','SecureStore'])assert.equal(wallet.includes(prohibited),false,prohibited);
});

test('mobile bundles the accepted endpoint contract and fails closed for a pending Finance API',()=>{
  for(const marker of ['1.0.0-p0.2','3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5','fa0ffd9bbbcc831438078be8e19cebff51b07e5e','"finance":{"status":"PENDING"','"appGateway": {"status":"UNAVAILABLE"'])assert.ok(manifest.includes(marker),marker);
  assert.ok(wallet.includes('PRODUCT_SESSION_UNAVAILABLE'));
  assert.ok(wallet.includes('WALLET_NOT_FOUND'));
});

test('mobile restores only an approved account and clears it on provider lifecycle changes',async()=>{
  const first='0x1111111111111111111111111111111111111111',second='0x2222222222222222222222222222222222222222';
  const listeners=new Map<string,(value:unknown)=>void>(),state:{accounts:unknown[];chainId:string}={accounts:[first],chainId:'0x1917'};
  const provider:EIP1193Provider={request:async({method})=>method==='eth_accounts'?state.accounts:method==='eth_chainId'?state.chainId:Promise.reject(new Error(`unexpected ${method}`)),on:(event,listener)=>void listeners.set(event,listener),removeListener:(event,listener)=>{if(listeners.get(event)===listener)listeners.delete(event)}};
  assert.deepEqual(await restoreStandardWallet(provider),{account:first,chainId:'0x1917',state:'STANDARD_CONNECTED'});
  const observed:Array<{connection:string|null;error?:string}>=[],stop=watchStandardWallet((connection,error)=>observed.push({connection:connection?.account||null,error:error?.message}),provider);
  state.accounts=[second];listeners.get('accountsChanged')?.(state.accounts);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(observed.at(-1)?.connection,second);
  assert.equal(observed.at(-1)?.error,undefined);
  state.chainId='0x1';listeners.get('chainChanged')?.(state.chainId);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(observed.at(-1)?.connection,null);
  assert.match(observed.at(-1)?.error||'',/WRONG_CHAIN/);
  stop();
});
