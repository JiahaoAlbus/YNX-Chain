import { afterEach, describe, expect, it, vi } from 'vitest';
import { walletIdentity, evmAddressFromYNX } from '@ynx-chain/wallet-auth';
import { loadNativePortfolio, nativeLedgerAddress, formatAtomic } from './portfolio';
import { parseNativeSnapshot } from './native-snapshot';
import { portfolioCopy } from './portfolio-i18n';
import { beginDexAction } from './wallet';
import { locales } from './i18n';
import { nativeFixture, GOLDEN_ACCOUNT as A } from './fixtures/native-fixture';
import golden from './fixtures/finance-snapshot-fixture.json';
const B=`0x${'b'.repeat(40)}`;
function serve(body=nativeFixture()){
  const fetch=vi.fn(async()=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}}));
  vi.stubGlobal('fetch',fetch);return fetch;
}
afterEach(()=>vi.unstubAllGlobals());
describe('Core atomic native portfolio contract',()=>{
  it('accepts the exact Core golden fixture without claiming BFT finality or checkpoint identity',()=>{
    const p=parseNativeSnapshot(golden,A,Date.parse(golden.asOf));
    expect(p).toMatchObject({atomic:true,consensusFinality:false,appHash:null,stateScope:'authoritative-current-including-pending',snapshotId:golden.snapshotId});
    expect(p.durableCheckpoint?.snapshotIntegrity).not.toBe(p.snapshotId);
  });
  it('uses one credential-free no-store read for all account/assets/shares',async()=>{
    const fetch=serve(),p=await loadNativePortfolio(A);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/v1/native-snapshot?account=${A}`,expect.objectContaining({credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}}));
    expect(p).toMatchObject({address:A,balanceAtomic:'899997',stakedAtomic:'0',nonce:'3',nextNonce:'4',atomicSnapshot:true,consensusFinality:false});
    expect(p.assets).toHaveLength(2);expect(p.assets.filter(a=>a.assetId==='YNXT')).toHaveLength(1);
    expect(p.positions[0]).toMatchObject({shares:'141421',claim0Atomic:'100000',claim1Atomic:'200000',blockHeight:'1'});
    expect(formatAtomic('1234567',6)).toBe('1.234567');expect(formatAtomic('1',18)).toBe('0.000000000000000001');
  });
  it('isolates owners and does not interpret address mapping as authority',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(JSON.stringify(nativeFixture(path.endsWith(B)?B:A)))));
    const [a,b]=await Promise.all([loadNativePortfolio(A),loadNativePortfolio(B)]);
    expect(a.positions).toHaveLength(1);expect(b.positions).toHaveLength(0);
    const ynx=walletIdentity('01'.padStart(64,'0')).account;
    expect(nativeLedgerAddress(ynx)).toBe(evmAddressFromYNX(ynx));
    expect(nativeLedgerAddress(A.toUpperCase().replace('0X','0x'))).toBe(A);
    expect(()=>nativeLedgerAddress('javascript:bad')).toThrow('INVALID_ACCOUNT');
  });
  it('requires explicit zero balances for every registered asset, never infers omitted zero',async()=>{
    const f=nativeFixture();f.account={address:A,exists:false,balance:'0',staked:'0',nonce:'0',nextNonce:'1'};
    f.balances.forEach((b:any)=>b.amount='0');f.pools=[];f.events=[];serve(f);
    expect((await loadNativePortfolio(A)).assets.every(a=>a.amountAtomic==='0')).toBe(true);
  });
  it('preserves int64 amounts and uint64 nonce as strings, including exhausted nextNonce',async()=>{
    const f=nativeFixture();f.account.balance='9223372036854775807';f.balances[0].amount=f.account.balance;
    f.account.nonce='18446744073709551615';f.account.nextNonce=null;serve(f);
    expect(await loadNativePortfolio(A)).toMatchObject({balanceAtomic:'9223372036854775807',nonce:'18446744073709551615',nextNonce:null});
  });
  it('accepts pending/current state with no local checkpoint without promoting finality',async()=>{
    const f=nativeFixture();f.durableCheckpoint=null;f.pendingTransactionCount=1;
    f.events[2].stage='pending';f.events[2].blockHeight='0';f.events[2].blockHash='';serve(f);
    expect(await loadNativePortfolio(A)).toMatchObject({consensusFinality:false,pendingTransactionCount:1});
  });
  it.each([
    ['wrong schema',(f:any)=>{f.schemaVersion='native-dex-schema-v1';}],
    ['wrong source',(f:any)=>{f.source='demo';}],
    ['wrong chain',(f:any)=>{f.chainId='0x1917';}],
    ['not atomic',(f:any)=>{f.atomic=false;}],
    ['false finality',(f:any)=>{f.consensusFinality=true;}],
    ['false appHash',(f:any)=>{f.appHash='a'.repeat(64);}],
    ['partial coverage',(f:any)=>{f.coverage.complete=false;}],
    ['unrequested balances',(f:any)=>{f.coverage.balances=false;}],
    ['mismatched observation',(f:any)=>{f.updatedAt='2020-01-01T00:00:00Z';}],
    ['bad snapshot identity',(f:any)=>{f.snapshotId='not-a-hash';}],
    ['account mismatch',(f:any)=>{f.account.address=B;}],
    ['owner mismatch',(f:any)=>{f.balances[1].account=B;}],
    ['unsafe numeric amount',(f:any)=>{f.account.balance=9007199254740992;}],
    ['negative amount',(f:any)=>{f.account.balance='-1';}],
    ['noncanonical amount',(f:any)=>{f.account.balance='01';}],
    ['overflow amount',(f:any)=>{f.account.balance='9223372036854775808';}],
    ['nonce mismatch',(f:any)=>{f.account.nextNonce='5';}],
    ['duplicate asset',(f:any)=>{f.assets.push(f.assets[0]);}],
    ['duplicate balance',(f:any)=>{f.balances.push(f.balances[0]);}],
    ['missing balance',(f:any)=>{f.balances.pop();}],
    ['missing native',(f:any)=>{f.assets.shift();}],
    ['native decimals',(f:any)=>{f.assets[0].decimals=18;}],
    ['native balance mismatch',(f:any)=>{f.balances[0].amount='1';}],
    ['unknown asset',(f:any)=>{f.balances[1].assetId='other-asset';}],
    ['missing shares',(f:any)=>{delete f.pools[0].shares;}],
    ['share total mismatch',(f:any)=>{f.pools[0].totalShares='900';}],
    ['duplicate owner',(f:any)=>{f.pools[0].shares.push(f.pools[0].shares[0]);}],
    ['duplicate pool',(f:any)=>{f.pools.push(f.pools[0]);}],
    ['event alias mismatch',(f:any)=>{f.events[0].txHash='0x'+'d'.repeat(64);}],
    ['false event inclusion',(f:any)=>{f.events[0].stage='pending';}],
    ['duplicate event',(f:any)=>{f.events.push(f.events[0]);}],
  ])('rejects %s',async(_label,mutate)=>{
    const f=nativeFixture();mutate(f);serve(f);await expect(loadNativePortfolio(A)).rejects.toThrow('INVALID_RESPONSE');
  });
  it.each([-16*60_000,31_000])('rejects stale/future response offset %s',async(offset)=>{
    const f=nativeFixture();f.asOf=f.updatedAt=new Date(Date.now()+offset).toISOString();serve(f);
    await expect(loadNativePortfolio(A)).rejects.toThrow('STALE');
  });
  it('requires exact market-only scope for guest reads',()=>{
    const f=nativeFixture(null);expect(parseNativeSnapshot(f).account).toBeNull();
    f.balances=[golden.balances[0]];expect(()=>parseNativeSnapshot(f)).toThrow('INVALID_RESPONSE');
  });
  it('treats missing route as unavailable, never zero or fallback legacy reads',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('{}',{status:404}));vi.stubGlobal('fetch',fetch);
    await expect(loadNativePortfolio(A)).rejects.toThrow('UNAVAILABLE');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('has complete translation keys in all 12 locales',()=>{
    expect(Object.keys(portfolioCopy).sort()).toEqual([...locales].sort());
    for(const copy of Object.values(portfolioCopy)){expect(Object.keys(copy)).toEqual(Object.keys(portfolioCopy.en));for(const t of Object.values(copy))expect(t.length).toBeGreaterThan(0);}
  });
  it('does not turn missing native signer into lost standard connection or any transport',async()=>{
    const fetch=serve();
    await expect(beginDexAction({action:'dex_swap_exact_input',payload:{poolId:'dex_ynxt_yusd',deadlineUnix:1},quote:{} as never,accountNonce:1})).rejects.toMatchObject({code:'NATIVE_ACTION_SIGNER_UNAVAILABLE'});
    expect(fetch).not.toHaveBeenCalled();
  });
});
