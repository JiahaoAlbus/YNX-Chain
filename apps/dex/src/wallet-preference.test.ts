import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {connectStandardWallet, disconnectStandardWallet, readStandardWalletProviderPreference, restoreStandardWallet, standardWalletDetails, YNX_EVM_CHAIN} from './wallet';

const key='ynx.dex.standard-wallet.v1.provider';
const account=`0x${'a'.repeat(40)}`;
const provider=()=>({request:vi.fn(async ({method}:{method:string})=>{
  if(method==='eth_chainId')return YNX_EVM_CHAIN.chainId;
  if(method==='eth_accounts'||method==='eth_requestAccounts')return [account];
  return null;
})});

describe('DEX saved standard provider preference',()=>{
  beforeEach(()=>{localStorage.clear();disconnectStandardWallet()});
  afterEach(()=>{disconnectStandardWallet();vi.restoreAllMocks()});

  it('stores only provider identity after verified connection, never account or token',async()=>{
    await connectStandardWallet(provider(),'metamask');
    expect(readStandardWalletProviderPreference()).toBe('metamask');
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(key)).toBe('metamask');
    disconnectStandardWallet();
    expect(readStandardWalletProviderPreference()).toBeNull();
  });

  it('does not save a rejected account request',async()=>{
    const rejected=provider();
    rejected.request.mockImplementation(async ({method})=>{
      if(method==='eth_requestAccounts')throw Object.assign(new Error('rejected'),{code:4001});
      return YNX_EVM_CHAIN.chainId;
    });
    await expect(connectStandardWallet(rejected,'ynx-wallet')).rejects.toThrow('rejected');
    expect(readStandardWalletProviderPreference()).toBeNull();
  });

  it('ignores malformed preference and treats inaccessible storage as no restore consent',()=>{
    for(const value of ['ethereum','{"provider":"metamask"}','',account]){
      localStorage.setItem(key,value);
      expect(readStandardWalletProviderPreference()).toBeNull();
    }
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked')});
    expect(readStandardWalletProviderPreference()).toBeNull();
  });

  it('does not reconnect when a pending restore resolves after explicit disconnect',async()=>{
    let resolveAccounts!:(accounts:string[])=>void;
    const oldProvider={request:vi.fn(async({method}:{method:string})=>method==='eth_accounts'?new Promise<string[]>(resolve=>{resolveAccounts=resolve}):YNX_EVM_CHAIN.chainId)};
    const restore=restoreStandardWallet(oldProvider,'ynx-wallet');
    disconnectStandardWallet();
    resolveAccounts([account]);
    await expect(restore).resolves.toBeNull();
    expect(standardWalletDetails().status).toBe('disconnected');
  });

  it('does not overwrite a newer MetaMask selection with a slow YNX restore',async()=>{
    let resolveAccounts!:(accounts:string[])=>void;
    const oldProvider={request:vi.fn(async({method}:{method:string})=>method==='eth_accounts'?new Promise<string[]>(resolve=>{resolveAccounts=resolve}):YNX_EVM_CHAIN.chainId)};
    const restore=restoreStandardWallet(oldProvider,'ynx-wallet');
    await connectStandardWallet(provider(),'metamask');
    resolveAccounts([`0x${'b'.repeat(40)}`]);
    await expect(restore).resolves.toBeNull();
    expect(standardWalletDetails()).toMatchObject({status:'connected',providerKind:'metamask',account});
    expect(readStandardWalletProviderPreference()).toBe('metamask');
  });

  it('does not apply a restore from an unmounted view or send an account prompt',async()=>{
    let current=true;
    const selected=provider();
    const restore=restoreStandardWallet(selected,'metamask',()=>current);
    current=false;
    await expect(restore).resolves.toBeNull();
    expect(standardWalletDetails().status).toBe('disconnected');
    expect(selected.request.mock.calls.map(([call])=>call.method)).toEqual(['eth_accounts','eth_chainId']);
  });

  it('stops explicit connection before account approval when its view is cancelled',async()=>{
    let current=true;
    let finishSwitch!:(value:null)=>void;
    const selected={request:vi.fn(async({method}:{method:string})=>{
      if(method==='wallet_switchEthereumChain')return new Promise<null>(resolve=>{finishSwitch=resolve});
      return YNX_EVM_CHAIN.chainId;
    })};
    const connecting=connectStandardWallet(selected,'metamask',()=>current);
    current=false;
    finishSwitch(null);
    await expect(connecting).rejects.toMatchObject({code:'WALLET_REQUEST_SUPERSEDED'});
    expect(selected.request.mock.calls.map(([call])=>call.method)).toEqual(['wallet_switchEthereumChain']);
    expect(readStandardWalletProviderPreference()).toBeNull();
  });
});
