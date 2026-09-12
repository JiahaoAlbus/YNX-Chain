import { afterEach, describe, expect, it, vi } from 'vitest';
import { broadcastDexAction,loadAccountNonce,loadDexSnapshot } from './api';
import { type DexActionResponse } from '@ynx-chain/wallet-auth';
import { nativeFixture,GOLDEN_ACCOUNT } from './fixtures/native-fixture';

const HASH='0x'+'a'.repeat(64);
const POOL={id:'dex_ynxt_yusd',kind:'ynx-cpmm-v1',asset0:'YNXT',asset1:'yusd-test',reserve0:1000,reserve1:2000,feeBps:30,totalShares:1400,blockHeight:19,updatedAt:'2026-08-10T03:00:00.000Z',txHash:HASH,auditHash:'b'.repeat(64)};
const EVENT={id:'event-1',type:'dex_swap_exact_input',poolId:POOL.id,signer:'0x'+'1'.repeat(40),amount0:10,amount1:19,blockHeight:20,occurredAt:'2026-08-10T03:00:01.000Z',txHash:HASH,auditHash:'c'.repeat(64)};
const ACTION={action:'dex_swap_exact_input',transactionHash:HASH,signedTransaction:{payload:{poolId:POOL.id}}} as unknown as DexActionResponse;
function serve(body:unknown){const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(body),{status:200}));vi.stubGlobal('fetch',fetch);return fetch;}
afterEach(()=>vi.unstubAllGlobals());
describe('DEX atomic current-state boundary',()=>{
  it('loads exact source schema without duplicate native asset or false committed/finality classification',async()=>{
    serve(nativeFixture(null));const s=await loadDexSnapshot();
    expect(s.tokens).toHaveLength(2);expect(s.tokens[0].reviewStatus).toBe('authoritative-current-testnet');
    expect(s.provenance).toMatchObject({version:'ynx-native-finance-snapshot-v1',status:'current-including-pending',atomic:true,consensusFinality:false,latestBlock:1});
    expect(s.events[0]).toMatchObject({stage:'included',feesKnown:false});
    expect(s.pools[0]).toMatchObject({reserve0:'100000',contractVersion:'ynx-native-dex-cpmm-v1'});
  });
  it('preserves string reserves greater than 2^53 exactly for BigInt quotes',async()=>{
    const f=nativeFixture(null);f.pools[0].reserve0='9223372036854775807';serve(f);
    expect((await loadDexSnapshot()).pools[0].reserve0).toBe('9223372036854775807');
  });
  it('uses account snapshot nonce and refuses unsafe/exhausted JSON-number signing input',async()=>{
    const f=nativeFixture(),fetch=serve(f);
    await expect(loadAccountNonce(GOLDEN_ACCOUNT)).resolves.toBe(3);
    expect(fetch).toHaveBeenCalledWith(`/v1/native-snapshot?account=${GOLDEN_ACCOUNT}`,expect.objectContaining({credentials:'omit'}));
    f.account.nonce='9007199254740991';f.account.nextNonce='9007199254740992';serve(f);
    await expect(loadAccountNonce(GOLDEN_ACCOUNT)).rejects.toThrow('supported signing range');
  });
  it('rejects the old unversioned snapshot rather than silently substituting a second ledger',async()=>{
    serve({source:'authoritative chain-native YNX Testnet state',updatedAt:new Date().toISOString(),assets:[],pools:[],events:[]});
    await expect(loadDexSnapshot()).rejects.toThrow('INVALID_RESPONSE');
  });
  it('broadcast legacy adapter requires matching transaction and pool; no UI signer currently enables it',async()=>{
    const f={source:'ynx-consensus-abci',version:'abci-state-v13',failure:false,event:EVENT,pool:POOL},fetch=serve(f);
    expect((await broadcastDexAction(ACTION)).transactionHash).toBe(HASH);
    expect(fetch).toHaveBeenCalledWith('/dex/pools/dex_ynxt_yusd/swaps/exact-input',expect.objectContaining({method:'POST',body:JSON.stringify(ACTION.signedTransaction)}));
    f.event={...EVENT,txHash:'0x'+'d'.repeat(64)};serve(f);
    await expect(broadcastDexAction(ACTION)).rejects.toThrow('does not match');
  });
  it('rejects non-JSON mutation result and never synthesizes transaction success',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<html>app</html>',{status:200})));
    await expect(broadcastDexAction(ACTION)).rejects.toThrow('failed closed');
  });
});
