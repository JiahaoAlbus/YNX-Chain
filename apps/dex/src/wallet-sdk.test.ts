import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { connectStandardWallet,disconnectStandardWallet,observeStandardWallet,restoreStandardWallet,revokeStandardWallet,standardWalletDetails,readStandardWalletProviderPreference } from './wallet';
const account='0x'+'a'.repeat(40);
function provider(){
  let exposed=[account];const listeners=new Map<string,Set<(value:unknown)=>void>>();
  return {request:vi.fn(async({method}:{method:string}):Promise<unknown>=>{
    if(method==='eth_chainId')return '0x1917';
    if(method==='eth_accounts'||method==='eth_requestAccounts')return exposed;
    if(method==='wallet_revokePermissions'){exposed=[];return null;}
    return null;
  }),on(event:string,fn:(value:unknown)=>void){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(fn);},removeListener(event:string,fn:(value:unknown)=>void){listeners.get(event)?.delete(fn);},emit(event:string,value:unknown){for(const fn of listeners.get(event)??[])fn(value);}};
}
beforeEach(()=>{localStorage.clear();disconnectStandardWallet();});
afterEach(()=>{disconnectStandardWallet();vi.unstubAllGlobals();});
describe('fixed c97f85e9 shared standard SDK consumer',()=>{
  it('vendors the exact standalone source closure with no bare module imports',()=>{
    const bytes=readFileSync(resolve(process.cwd(),'src/vendor/standard-wallet-browser.mjs'));
    expect(bytes.length).toBe(22417);expect(createHash('sha256').update(bytes).digest('hex')).toBe('b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43');
    expect(bytes.toString()).not.toMatch(/^import\s/m);
  });
  it('confirms revoke only after acknowledged permission plus empty account readback, single flight',async()=>{
    const p=provider();await connectStandardWallet(p,'metamask');p.request.mockClear();
    const results=await Promise.all([revokeStandardWallet(),revokeStandardWallet()]);
    expect(results.every(r=>r.permissionRevoked&&r.status==='revoked')).toBe(true);
    expect(p.request.mock.calls.map(([r])=>r.method)).toEqual(['wallet_revokePermissions','eth_accounts']);
    expect(readStandardWalletProviderPreference()).toBeNull();expect(standardWalletDetails().status).toBe('disconnected');
  });
  it.each([[4001,'rejected'],[-32601,'unsupported'],[4900,'failed']] as const)('does not claim remote revoke after provider code %s',async(code,status)=>{
    const p=provider();await connectStandardWallet(p,'ynx-wallet');
    const original=p.request.getMockImplementation()!;
    p.request.mockImplementation(async input=>{if(input.method==='wallet_revokePermissions')throw {code};return original(input);});
    expect(await revokeStandardWallet()).toMatchObject({status,permissionRevoked:false});
    expect(standardWalletDetails().status).toBe('connected');
  });
  it('does not accept revoke ACK while accounts remain exposed',async()=>{
    const p=provider();await connectStandardWallet(p,'metamask');
    p.request.mockImplementation(async({method})=>method==='wallet_revokePermissions'?null:[account]);
    expect(await revokeStandardWallet()).toMatchObject({status:'failed',permissionRevoked:false});
    expect(standardWalletDetails().status).toBe('connected');
  });
  it('local disconnect invokes no revoke RPC and ignored old provider events cannot restore authority',async()=>{
    const p=provider();await connectStandardWallet(p,'metamask');const seen=vi.fn();const stop=observeStandardWallet(p,seen);p.request.mockClear();
    disconnectStandardWallet();p.emit('accountsChanged',[account]);stop();
    expect(p.request).not.toHaveBeenCalled();expect(seen).not.toHaveBeenCalled();expect(standardWalletDetails().status).toBe('disconnected');
  });
  it('restores empty account without grant, add/switch, Gateway or even unnecessary chain read',async()=>{
    const p=provider();p.request.mockResolvedValue([]);
    expect(await restoreStandardWallet(p,'ynx-wallet')).toBeNull();
    expect(p.request.mock.calls.map(([r])=>r.method)).toEqual(['eth_accounts']);
  });
  it('does not let a late revoke outcome clear a newer selected Wallet',async()=>{
    const old=provider();await connectStandardWallet(old,'metamask');
    let acknowledge!:(value:null)=>void;
    old.request.mockImplementation(async({method})=>method==='wallet_revokePermissions'?new Promise<null>(resolve=>{acknowledge=resolve;}):[]);
    const pending=revokeStandardWallet();
    await vi.waitFor(()=>expect(acknowledge).toBeTypeOf('function'));
    const next=provider();await connectStandardWallet(next,'ynx-wallet');
    acknowledge(null);
    expect(await pending).toMatchObject({status:'superseded',permissionRevoked:false});
    expect(standardWalletDetails()).toMatchObject({status:'connected',providerKind:'ynx-wallet',account});
    expect(readStandardWalletProviderPreference()).toBe('ynx-wallet');
  });
  it('rejects wrong chain after account approval if the Wallet changed networks during approval',async()=>{
    const p=provider();let reads=0;
    p.request.mockImplementation(async({method})=>method==='eth_chainId'?(++reads===1?'0x1917':'0x1'):method==='eth_requestAccounts'?[account]:null);
    await expect(connectStandardWallet(p,'metamask')).rejects.toMatchObject({code:'WRONG_NETWORK'});
    expect(readStandardWalletProviderPreference()).toBeNull();expect(standardWalletDetails().status).not.toBe('connected');
  });
});
