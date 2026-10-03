import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelWalletConnection, clearWalletSession, onStandardConnectionChange, restoreStandardConnection, standardConnection, startWalletAuth } from '../wallet-auth.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';

test('MetaMask connection requests account and adds then switches YNX Testnet', async () => {
  const calls = [];
  let chainId = '0x1';
  const provider = {
    isMetaMask: true,
    async request(payload) {
      calls.push(payload);
      if (payload.method === 'eth_requestAccounts' || payload.method === 'eth_accounts') return [ACCOUNT];
      if (payload.method === 'eth_chainId') return chainId;
      if (payload.method === 'wallet_switchEthereumChain' && chainId !== '0x1917') {
        if (!calls.some(call => call.method === 'wallet_addEthereumChain')) throw Object.assign(new Error('unknown chain'), { code: 4902 });
        chainId = '0x1917';
        return null;
      }
      if (payload.method === 'wallet_addEthereumChain') return null;
      throw new Error(`Unexpected method ${payload.method}`);
    },
  };
  const connection = await startWalletAuth('buyer', { wallet: 'metamask', scope: { ethereum: provider }, waitMs: 0 });
  assert.deepEqual(connection, { account: ACCOUNT, chainId: '0x1917', wallet: 'metamask', transport: 'eip-1193' });
  assert.equal(standardConnection(), connection);
  assert.deepEqual(calls.map(call => call.method), ['eth_requestAccounts', 'eth_chainId', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain', 'eth_chainId', 'eth_accounts', 'eth_chainId']);
  assert.deepEqual(calls.find(call => call.method === 'wallet_addEthereumChain').params[0], {
    chainId: '0x1917',
    chainName: 'YNX Testnet',
    nativeCurrency: { name: 'YNX Testnet', symbol: 'YNXT', decimals: 18 },
    rpcUrls: ['https://evm.ynxweb4.com'],
    blockExplorerUrls: ['https://explorer.ynxweb4.com'],
  });
  clearWalletSession();
});

test('Web connection never substitutes MetaMask when YNX Wallet was explicitly chosen', async () => {
  const provider = { isMetaMask: true, request: async () => [ACCOUNT] };
  await assert.rejects(
    startWalletAuth('buyer', { wallet: 'ynx', scope: { ethereum: provider }, waitMs: 0 }),
    error => error.code === 'YNX_WALLET_NOT_FOUND' && error.fallbackURL === 'https://www.ynxweb4.com/dapp/download',
  );
  assert.equal(standardConnection(), null);
});

test('YNX Wallet provider connects without a custom-scheme navigation', async () => {
  const calls = [];
  const provider = {
    isYNXWallet: true, providerInfo: {rdns: "com.ynx.wallet"},
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_requestAccounts' || payload.method === 'eth_accounts') return [ACCOUNT];
      if (payload.method === 'eth_chainId') return '0x1917';
      throw new Error(`Unexpected method ${payload.method}`);
    },
  };
  const connection = await startWalletAuth('buyer', { wallet: 'ynx', scope: { ethereum: provider }, waitMs: 0 });
  assert.equal(connection.wallet, 'ynx-wallet');
  assert.deepEqual(calls, ['eth_requestAccounts', 'eth_chainId', 'eth_chainId', 'eth_accounts', 'eth_chainId']);
  clearWalletSession();
});

test('refresh restores an already-approved account without prompting again', async () => {
  const calls = [];
  const provider = {
    isMetaMask: true,
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_accounts') return [ACCOUNT];
      if (payload.method === 'eth_chainId') return '0x1917';
      throw new Error(`Unexpected method ${payload.method}`);
    },
  };
  const connection = await restoreStandardConnection({ scope: { ethereum: provider }, waitMs: 0 });
  assert.deepEqual(connection, { account: ACCOUNT, chainId: '0x1917', wallet: 'metamask', transport: 'eip-1193' });
  assert.deepEqual(calls, ['eth_accounts', 'eth_chainId']);
  assert.equal(calls.includes('eth_requestAccounts'), false);
  clearWalletSession();
});

test('account and chain events update or invalidate the standard connection', async () => {
  const listeners = new Map();
  const provider = {
    isMetaMask: true,
    on(event, listener) { listeners.set(event, listener); },
    removeListener(event) { listeners.delete(event); },
    async request(payload) {
      if (payload.method === 'eth_requestAccounts' || payload.method === 'eth_accounts') return [ACCOUNT];
      if (payload.method === 'eth_chainId') return '0x1917';
      throw new Error(`Unexpected method ${payload.method}`);
    },
  };
  const observed = [];
  const unsubscribe = onStandardConnectionChange(value => observed.push(value));
  await startWalletAuth('buyer', { wallet: 'metamask', scope: { ethereum: provider }, waitMs: 0 });
  const next = '0x2222222222222222222222222222222222222222';
  listeners.get('accountsChanged')([next]);
  assert.equal(standardConnection().account, next);
  listeners.get('chainChanged')('0x1');
  assert.equal(standardConnection(), null);
  assert.equal(observed.at(-1), null);
  unsubscribe();
});

test('logout while silent account restoration is pending cannot reconnect',async()=>{
  let resolveAccounts,started;const ready=new Promise(resolve=>started=resolve);
  const provider={isMetaMask:true,async request({method}){if(method==='eth_accounts'){started();return new Promise(resolve=>resolveAccounts=resolve)}if(method==='eth_chainId')return '0x1917';throw Error(method)}};
  const pending=restoreStandardConnection({scope:{ethereum:provider},waitMs:0});await ready;clearWalletSession();resolveAccounts([ACCOUNT]);assert.equal(await pending,null);assert.equal(standardConnection(),null);
});

test('closing a pending chooser prevents chain prompts and late connection',async()=>{
  let resolveAccounts,started;const ready=new Promise(resolve=>started=resolve),calls=[];
  const provider={isMetaMask:true,async request({method}){calls.push(method);if(method==='eth_requestAccounts'){started();return new Promise(resolve=>resolveAccounts=resolve)}throw Error('Cancelled request must not switch chain')}};
  const pending=startWalletAuth('buyer',{wallet:'metamask',scope:{ethereum:provider},waitMs:0});await ready;cancelWalletConnection();resolveAccounts([ACCOUNT]);
  await assert.rejects(pending,error=>error.code==='COMMERCE_CONTEXT_CHANGED');assert.equal(standardConnection(),null);assert.deepEqual(calls,['eth_requestAccounts']);
});


test('account event during chain switch rejects the old connection and removes owned SDK listeners',async()=>{
 const handlers=new Map();let chain='0x1';const calls=[];
 const provider={isMetaMask:true,on(event,fn){handlers.set(event,fn)},removeListener(event,fn){if(handlers.get(event)===fn)handlers.delete(event)},async request({method}){calls.push(method);if(method==='eth_requestAccounts'||method==='eth_accounts')return [ACCOUNT];if(method==='eth_chainId')return chain;if(method==='wallet_switchEthereumChain'){chain='0x1917';handlers.get('accountsChanged')(['0x2222222222222222222222222222222222222222']);return null}throw Error(method)}};
 await assert.rejects(startWalletAuth('buyer',{wallet:'metamask',scope:{ethereum:provider},waitMs:0}),error=>error.code==='COMMERCE_CONTEXT_CHANGED');
 assert.equal(standardConnection(),null);assert.equal(handlers.size,0);assert.equal(calls.includes('eth_accounts'),false);
});

test('successful switch without matching silent account readback cannot connect',async()=>{
 let chain='0x1';const provider={isMetaMask:true,async request({method}){if(method==='eth_requestAccounts')return [ACCOUNT];if(method==='eth_accounts')return ['0x2222222222222222222222222222222222222222'];if(method==='eth_chainId')return chain;if(method==='wallet_switchEthereumChain'){chain='0x1917';return null}throw Error(method)}};
 await assert.rejects(startWalletAuth('buyer',{wallet:'metamask',scope:{ethereum:provider},waitMs:0}),error=>error.code==='COMMERCE_CONTEXT_CHANGED');assert.equal(standardConnection(),null);
});

test('chain switch rejection never adds a network or requests another grant',async()=>{
 const calls=[];const provider={isMetaMask:true,async request({method}){calls.push(method);if(method==='eth_requestAccounts')return [ACCOUNT];if(method==='eth_chainId')return '0x1';if(method==='wallet_switchEthereumChain')throw Object.assign(Error('user rejected'),{code:4001});throw Error(method)}};
 await assert.rejects(startWalletAuth('buyer',{wallet:'metamask',scope:{ethereum:provider},waitMs:0}),error=>error.code==='CHAIN_SWITCH_REJECTED'&&error.cause.code===4001);assert.equal(calls.filter(method=>method==='eth_requestAccounts').length,1);assert.equal(calls.includes('wallet_addEthereumChain'),false);assert.equal(standardConnection(),null);
});

test('a conflicted announcement cannot reappear through the injected fallback',async()=>{
 let grants=0;const first={isMetaMask:true,request:async()=>{grants++;return [ACCOUNT]}},second={isMetaMask:true,request:async()=>[]};
 const scope=new EventTarget();scope.ethereum=first;scope.Event=Event;scope.addEventListener('eip6963:requestProvider',()=>{for(const provider of [first,second]){const event=new Event('eip6963:announceProvider');event.detail={info:{uuid:'11111111-1111-4111-8111-111111111111',name:'MetaMask',rdns:'io.metamask'},provider};scope.dispatchEvent(event)}});
 await assert.rejects(startWalletAuth('buyer',{wallet:'metamask',scope,waitMs:0}),error=>error.code==='WALLET_PROVIDER_AMBIGUOUS');assert.equal(grants,0);assert.equal(standardConnection(),null);
});


test('silent restore never substitutes an installed wallet for the remembered choice',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');let calls=0;
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=> 'ynx-wallet'}});
 try{const provider={isMetaMask:true,request:async()=>{calls++;return [ACCOUNT]}};assert.equal(await restoreStandardConnection({scope:{ethereum:provider},waitMs:0}),null);assert.equal(calls,0);assert.equal(standardConnection(),null)}finally{if(previous)Object.defineProperty(globalThis,'sessionStorage',previous);else delete globalThis.sessionStorage}
});
