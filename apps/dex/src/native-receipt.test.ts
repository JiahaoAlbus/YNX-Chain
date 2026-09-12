import { afterEach,describe,expect,it,vi } from 'vitest';
import golden from './fixtures/finance-receipt-fixture.json';
import { loadNativeReceipt,parseNativeReceipt } from './native-receipt';
const hash=golden.transaction.hash;
const fixture=()=>structuredClone(golden);
afterEach(()=>vi.unstubAllGlobals());
describe('Core 28d30b4b read-only native transaction receipt',()=>{
  it('consumes the exact Core golden durable receipt without promoting finality or token amounts',()=>{
    const r=parseNativeReceipt(golden,hash);
    expect(r).toMatchObject({hash,status:'durable',consensusFinality:false,transaction:{nonce:'3',fee:'1',blockNumber:'1',action:'dex_liquidity_add'}});
    expect(r.durability?.scope).toBe('local-snapshot');
    expect(r.transaction).not.toHaveProperty('amount0');
  });
  it.each(['memory_only','uncertain','pending_durable'] as const)('keeps %s separate from durable inclusion',status=>{
    const f=fixture();f.status=status;f.transaction.blockNumber='0';f.transaction.blockHash='';
    if(status!=='pending_durable')f.durability={...f.durability,checkpointHeight:'0',checkpointHash:'',snapshotIntegrity:''};
    expect(parseNativeReceipt(f,hash)).toMatchObject({status,consensusFinality:false});
  });
  it('only accepts an exact 404 not_found for the requested hash, without authorizing a new intent',()=>{
    expect(parseNativeReceipt({status:'not_found',transactionHash:hash},hash,404)).toMatchObject({status:'not_found',transaction:null});
    expect(()=>parseNativeReceipt({status:'not_found',transactionHash:'0x'+'b'.repeat(64)},hash,404)).toThrow();
    expect(()=>parseNativeReceipt({status:'not_found',transactionHash:hash},hash,200)).toThrow();
  });
  it.each([
    (f:ReturnType<typeof fixture>)=>{f.consensusFinality=true;},
    (f:ReturnType<typeof fixture>)=>{f.transaction.hash='0x'+'b'.repeat(64);},
    (f:ReturnType<typeof fixture>)=>{f.transaction.from='ynx_invalid';},
    (f:ReturnType<typeof fixture>)=>{f.transaction.nonce='18446744073709551616';},
    (f:ReturnType<typeof fixture>)=>{f.transaction.fee='0';},
    (f:ReturnType<typeof fixture>)=>{f.transaction.blockNumber='2';},
    (f:ReturnType<typeof fixture>)=>{f.status='pending_durable';},
    (f:ReturnType<typeof fixture>)=>{f.durability.scope='consensus-finality';},
    (f:ReturnType<typeof fixture>)=>{f.durability.snapshotIntegrity='';},
    (f:ReturnType<typeof fixture>)=>{f.transaction.nonce='03';},
  ])('rejects contradictory/hash-mismatched/noncanonical evidence %#',mutate=>{
    const f=fixture();mutate(f);expect(()=>parseNativeReceipt(f,hash)).toThrow();
  });
  it('retains integers above JS-safe range exactly',()=>{
    const f=fixture();f.transaction.nonce='9007199254740993';expect(parseNativeReceipt(f,hash).transaction?.nonce).toBe('9007199254740993');
  });
  it('makes only one explicit no-store GET and rejects HTML fallback/503 without another RPC',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(golden),{status:200,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch);
    expect((await loadNativeReceipt(hash)).hash).toBe(hash);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/v1/native-transactions/'+hash,expect.objectContaining({method:'GET',credentials:'omit',cache:'no-store'}));
    fetch.mockResolvedValueOnce(new Response('<html/>',{status:200}));await expect(loadNativeReceipt(hash)).rejects.toThrow('INVALID_RESPONSE');
    fetch.mockResolvedValueOnce(new Response('{}',{status:503}));await expect(loadNativeReceipt(hash)).rejects.toThrow('UNAVAILABLE');expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('rejects path/query/uppercase hashes before any HTTP request',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    for(const v of [hash+'/../x',hash+'?a=1',hash.toUpperCase()])await expect(loadNativeReceipt(v)).rejects.toThrow('INVALID_HASH');
    expect(fetch).not.toHaveBeenCalled();
  });
});
