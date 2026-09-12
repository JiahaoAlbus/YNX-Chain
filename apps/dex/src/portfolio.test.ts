import { afterEach, describe, expect, it, vi } from 'vitest';
import { walletIdentity, evmAddressFromYNX } from '@ynx-chain/wallet-auth';
import { loadNativePortfolio, nativeLedgerAddress, formatAtomic } from './portfolio';
import { portfolioCopy } from './portfolio-i18n';
import { beginDexAction } from './wallet';
import { locales } from './i18n';

const A=`0x${'a'.repeat(40)}`,B=`0x${'b'.repeat(40)}`;
function fixture(address=A){
  const wrap=(key:string,items:unknown[])=>({source:'ynx-consensus-abci',version:'abci-state-v13',failure:false,coverage:{complete:true},[key]:items});
  return {
    [`/accounts/${address}`]:{address,balance:100,staked:20,nonce:4},
    [`/dex/balances/${address}`]:{...wrap('balances',[{assetId:'yusd-test',account:address,amount:1234567}]),address},
    '/dex/assets':wrap('assets',[{id:'yusd-test',symbol:'YUSD',decimals:6}]),
    '/dex/pools':wrap('pools',[{id:'dex_ynxt_yusd',asset0:'YNXT',asset1:'yusd-test',reserve0:1000,reserve1:2000000,totalShares:1000,shares:[{account:A,shares:250},{account:B,shares:750}],blockHeight:77}]),
  } as Record<string,any>;
}
function serve(bodies=fixture()){
  const fetch=vi.fn(async (path:RequestInfo|URL)=>new Response(JSON.stringify(bodies[String(path)]),{status:bodies[String(path)]?200:404,headers:{'content-type':'application/json'}}));
  vi.stubGlobal('fetch',fetch);return fetch;
}
afterEach(()=>vi.unstubAllGlobals());
describe('public native ledger portfolio, never a separate financial balance',()=>{
  it('reads exact account and complete balances/shares without credentials or writes',async()=>{
    const fetch=serve(),p=await loadNativePortfolio(A);
    expect(fetch.mock.calls.map(([path])=>path)).toEqual([`/accounts/${A}`,`/dex/balances/${A}`,'/dex/assets','/dex/pools']);
    for(const [,options] of (fetch.mock.calls as unknown as Array<[string,RequestInit]>))expect(options).toMatchObject({credentials:'omit',headers:{Accept:'application/json'}});
    expect(p).toMatchObject({address:A,balanceAtomic:'100',stakedAtomic:'20',nonce:'4',atomicSnapshot:false});
    expect(p.assets[1]).toMatchObject({amountAtomic:'1234567',decimals:6});
    expect(p.positions[0]).toMatchObject({shares:'250',claim0Atomic:'250',claim1Atomic:'500000',blockHeight:77});
    expect(formatAtomic('1234567',6)).toBe('1.234567');
    expect(formatAtomic('1',18)).toBe('0.000000000000000001');
  });
  it('isolates two users and never treats address mapping as signing permission',async()=>{
    serve({...fixture(A),...fixture(B)});
    const [a,b]=await Promise.all([loadNativePortfolio(A),loadNativePortfolio(B)]);
    expect(a.positions[0].shares).toBe('250');expect(b.positions[0].shares).toBe('750');
    const ynx=walletIdentity('01'.padStart(64,'0')).account;
    expect(nativeLedgerAddress(ynx)).toBe(evmAddressFromYNX(ynx));
    expect(nativeLedgerAddress(A.toUpperCase().replace('0X','0x'))).toBe(A);
    expect(()=>nativeLedgerAddress('javascript:bad')).toThrow('INVALID_ACCOUNT');
  });
  it('can show confirmed zero only with explicit complete asset coverage',async()=>{
    const f=fixture();f[`/dex/balances/${A}`].balances=[];f['/dex/pools'].pools=[];serve(f);
    expect((await loadNativePortfolio(A)).assets[1].amountAtomic).toBe('0');
  });
  it.each([
    ['account mismatch',(f:Record<string,any>)=>{f[`/accounts/${A}`].address=B;}],
    ['balance owner mismatch',(f:Record<string,any>)=>{f[`/dex/balances/${A}`].balances[0].account=B;}],
    ['partial coverage',(f:Record<string,any>)=>{f[`/dex/balances/${A}`].coverage.complete=false;}],
    ['wrong source',(f:Record<string,any>)=>{f['/dex/pools'].source='demo';}],
    ['unsafe amount',(f:Record<string,any>)=>{f[`/accounts/${A}`].balance=Number.MAX_SAFE_INTEGER+1;}],
    ['negative amount',(f:Record<string,any>)=>{f[`/accounts/${A}`].balance=-1;}],
    ['duplicate asset',(f:Record<string,any>)=>{f['/dex/assets'].assets.push(f['/dex/assets'].assets[0]);}],
    ['duplicate balance',(f:Record<string,any>)=>{f[`/dex/balances/${A}`].balances.push(f[`/dex/balances/${A}`].balances[0]);}],
    ['unknown asset',(f:Record<string,any>)=>{f[`/dex/balances/${A}`].balances[0].assetId='other-asset';}],
    ['missing shares',(f:Record<string,any>)=>{delete f['/dex/pools'].pools[0].shares;}],
    ['share total mismatch',(f:Record<string,any>)=>{f['/dex/pools'].pools[0].totalShares=900;}],
    ['duplicate owner',(f:Record<string,any>)=>{f['/dex/pools'].pools[0].shares[1].account=A;}],
  ])('fails closed on %s',async(_name,mutate)=>{
    const f=fixture();mutate(f);serve(f);await expect(loadNativePortfolio(A)).rejects.toThrow('INVALID_RESPONSE');
  });
  it('reports missing gateway route as unavailable, not zero',async()=>{
    const f=fixture();delete f['/dex/pools'];serve(f);await expect(loadNativePortfolio(A)).rejects.toThrow('UNAVAILABLE');
  });
  it('preserves exact large integer strings without floating point rounding',async()=>{
    const f=fixture();f[`/accounts/${A}`].balance='9223372036854775807';serve(f);
    expect((await loadNativePortfolio(A)).balanceAtomic).toBe('9223372036854775807');
  });
  it('provides complete new interface and error copy in all 12 supported languages',()=>{
    expect(Object.keys(portfolioCopy).sort()).toEqual([...locales].sort());
    for(const copy of Object.values(portfolioCopy)){
      expect(Object.keys(copy)).toEqual(Object.keys(portfolioCopy.en));
      for(const text of Object.values(copy))expect(text.length).toBeGreaterThan(0);
    }
  });
  it('does not classify missing native signing as lost standard connection or initiate any transport',async()=>{
    const fetch=serve();
    await expect(beginDexAction({action:'dex_swap_exact_input',payload:{poolId:'dex_ynxt_yusd',deadlineUnix:1},quote:{} as never,accountNonce:1})).rejects.toMatchObject({code:'NATIVE_ACTION_SIGNER_UNAVAILABLE'});
    expect(fetch).not.toHaveBeenCalled();
  });
});
