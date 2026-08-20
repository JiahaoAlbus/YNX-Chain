import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {connectMusicWallet,WALLET_INSTALLATION_OPTIONS} from '../web/wallet-connection.js';

const account='0x1111111111111111111111111111111111111111';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../web');

function provider({reject=false}={}){
  const calls=[];
  return {
    calls,
    async request(request){
      calls.push(request);
      if(request.method==='eth_requestAccounts'){
        if(reject)throw Object.assign(new Error('User rejected the request'),{code:4001});
        return [account];
      }
      if(request.method==='eth_chainId')return '0x1917';
      throw new Error(`Unexpected method ${request.method}`);
    },
  };
}

function discoveryWindow(details,{ethereum}={}){
  const target=new EventTarget();
  target.ethereum=ethereum;
  target.addEventListener('eip6963:requestProvider',()=>{
    for(const detail of details){
      const event=new Event('eip6963:announceProvider');
      Object.defineProperty(event,'detail',{value:detail});
      target.dispatchEvent(event);
    }
  });
  return target;
}

test('prefers the explicitly requested YNX Wallet and preserves private degradation',async()=>{
  const ynx=provider();
  const metamask=Object.assign(provider(),{isMetaMask:true});
  const windowLike=discoveryWindow([
    {info:{uuid:'metamask',name:'MetaMask',rdns:'io.metamask'},provider:metamask},
    {info:{uuid:'ynx',name:'YNX Wallet',rdns:'com.ynx.wallet'},provider:ynx},
  ]);
  const result=await connectMusicWallet('ynx',windowLike,{timeoutMs:0});
  assert.equal(result.account,account);
  assert.equal(result.chainId,'0x1917');
  assert.equal(result.standardConnection,'CONNECTED');
  assert.equal(result.productSession,'PRIVATE_SERVICE_DEGRADED');
  assert.equal(ynx.calls[0].method,'eth_requestAccounts');
  assert.equal(metamask.calls.length,0);
});

test('uses MetaMask only when the user explicitly selects it',async()=>{
  const ynx=provider();
  const metamask=Object.assign(provider(),{isMetaMask:true});
  const windowLike=discoveryWindow([
    {info:{uuid:'ynx',name:'YNX Wallet',rdns:'com.ynx.wallet'},provider:ynx},
  ],{ethereum:metamask});
  const result=await connectMusicWallet('metamask',windowLike,{timeoutMs:0});
  assert.equal(result.walletName,'MetaMask');
  assert.equal(metamask.calls[0].method,'eth_requestAccounts');
  assert.equal(ynx.calls.length,0);
});

test('rejects missing wallets and rejected approval without creating a fallback',async()=>{
  await assert.rejects(()=>connectMusicWallet('ynx',discoveryWindow([]),{timeoutMs:0}),error=>{
    assert.equal(error.code,'WALLET_NOT_INSTALLED');
    assert.equal(error.details.ynx,WALLET_INSTALLATION_OPTIONS.ynx);
    return true;
  });
  const denied=provider({reject:true});
  await assert.rejects(()=>connectMusicWallet('ynx',discoveryWindow([
    {info:{uuid:'ynx',name:'YNX Wallet',rdns:'com.ynx.wallet'},provider:denied},
  ]),{timeoutMs:0}),error=>error.code==='WALLET_USER_REJECTED');
});

test('vendored browser SDK is byte-identical to the accepted source manifest',async()=>{
  const manifest=JSON.parse(await readFile(path.join(root,'ynx-dapp-connect-sdk/manifest.json'),'utf8'));
  assert.equal(manifest.sourceCommit,'315897e75c0ffe3e63435fe73cfec42244b851cc');
  for(const [file,expected] of Object.entries(manifest.files)){
    const bytes=await readFile(path.join(root,'ynx-dapp-connect-sdk',file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,file);
  }
});
