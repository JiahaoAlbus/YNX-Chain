import {toUtf8Bytes,toUtf8String} from 'ethers';
/** Watch-only public P2WPKH reads; no account derivation, custody or writes.
 * Semantics match desktop multichain-bitcoin.mjs. Esplora API source:
 * https://github.com/Blockstream/esplora/blob/master/API.md */
export type BitcoinNetwork = 'mainnet' | 'testnet3' | 'testnet4' | 'signet';
const NETWORKS = Object.freeze({
  mainnet: {hrp:'bc',genesis:'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'},
  testnet3: {hrp:'tb',genesis:'000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943'},
  testnet4: {hrp:'tb',genesis:'00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043'},
  signet: {hrp:'tb',genesis:'00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6'},
});
const MAX_SATS=2100000000000000n, ALPHABET='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const MAX_BODY=1_000_000;
export class BitcoinReadError extends Error {constructor(readonly code:string){super(code);this.name='BitcoinReadError';}}
const fail=(code:string):never=>{throw new BitcoinReadError(code);};
function network(id:BitcoinNetwork){if(!Object.hasOwn(NETWORKS,id))return fail('BTC_NETWORK_UNSUPPORTED');return NETWORKS[id];}
function integer(value:unknown,max=MAX_SATS):bigint {
  if(typeof value==='number'&&!Number.isSafeInteger(value))return fail('BTC_INTEGER_REQUIRED');
  if(!['number','string','bigint'].includes(typeof value)||! /^(0|[1-9][0-9]*)$/.test(String(value)))return fail('BTC_INTEGER_REQUIRED');
  const n=BigInt(value as string);if(n>max)return fail('BTC_AMOUNT_RANGE');return n;
}
export function formatBitcoinSats(value:string):string {const n=integer(value);return `${n/100000000n}.${String(n%100000000n).padStart(8,'0')}`;}
// Deliberately the same supported address family as desktop, not all BTC scripts.
export function validateBitcoinReadAddress(value:string,id:BitcoinNetwork):string {
  const {hrp}=network(id);
  if(typeof value!=='string'||value.length<8||value.length>90||! /^[!-~]+$/.test(value)||(value!==value.toLowerCase()&&value!==value.toUpperCase()))return fail('BTC_ADDRESS_INVALID');
  const address=value.toLowerCase(),split=address.lastIndexOf('1');
  if(address.slice(0,split)!==hrp)return fail('BTC_ADDRESS_NETWORK');
  const words=[...address.slice(split+1)].map(c=>ALPHABET.indexOf(c));
  if(words.length<7||words.some(v=>v<0))return fail('BTC_ADDRESS_INVALID');
  const expanded=[...hrp].map(c=>c.charCodeAt(0)>>5).concat(0,[...hrp].map(c=>c.charCodeAt(0)&31));
  let checksum=1;
  for(const v of [...expanded,...words]){const top=checksum>>>25;checksum=((checksum&0x1ffffff)<<5)^v;for(const [i,g] of [0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3].entries())if((top>>>i)&1)checksum^=g;}
  if((checksum>>>0)!==1)return fail('BTC_ADDRESS_CHECKSUM');
  if(words[0]!==0)return fail('BTC_ADDRESS_TYPE_UNSUPPORTED');
  let bits=0,acc=0,count=0;
  for(const v of words.slice(1,-6)){acc=((acc<<5)|v)&0xffff;bits+=5;if(bits>=8){bits-=8;count++;}}
  if(bits>=5||((acc<<(8-bits))&255))return fail('BTC_ADDRESS_PADDING');
  if(count!==20)return fail('BTC_ADDRESS_TYPE_UNSUPPORTED');return address;
}
export type BitcoinBalanceRead=Readonly<{
  family:'bitcoin';network:BitcoinNetwork;address:string;source:string;genesis:string;unit:'sat';symbol:'BTC';decimals:8;
  confirmedSats:string;unconfirmedSats:string;totalSats:string;confirmedBTC:string;unconfirmedBTC:string;totalBTC:string;utxoCount:number;
  verification:'provider-reported-not-spv';watchOnly:true;signingSupported:false;broadcastSupported:false;
}>;
type FetchLike=(url:string,options:RequestInit)=>Promise<Response>;
type ReadOptions={signal?:AbortSignal;guard?:()=>void};
function endpoint(value:string):string {
  if(typeof value!=='string'||value.length>2048||/[\\%?#\s]/.test(value))return fail('BTC_ENDPOINT_INVALID');
  let url:URL;try{url=new URL(value);}catch{return fail('BTC_ENDPOINT_INVALID');}
  // Mobile fetch has no DNS/socket-pinning hook. Reject literal/local hosts;
  // a malicious public DNS resolver remains outside this read-only client.
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||! /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)||/(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(url.hostname)||! /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(url.pathname))return fail('BTC_ENDPOINT_INVALID');
  return url.href.replace(/\/$/,'');
}
export class BitcoinReadClient {
  readonly network:BitcoinNetwork;readonly baseURL:string;readonly timeoutMs:number;private readonly fetchImpl:FetchLike;
  constructor({network:id,baseURL,fetchImpl=globalThis.fetch,timeoutMs=12000}:{network:BitcoinNetwork;baseURL:string;fetchImpl?:FetchLike;timeoutMs?:number}) {
    network(id);this.network=id;this.baseURL=endpoint(baseURL);
    if(typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)fail('BTC_CONFIG_INVALID');
    this.fetchImpl=fetchImpl;this.timeoutMs=timeoutMs;
  }
  async readAddress(input:string,{signal,guard=()=>{}}:ReadOptions={}):Promise<BitcoinBalanceRead> {
    const id=this.network,source=this.baseURL,expected=network(id),address=validateBitcoinReadAddress(input,id),fetchImpl=this.fetchImpl;
    const controller=new AbortController();let stopped:string|null=null,timer:ReturnType<typeof setTimeout>|undefined;
    let rejectStop:(e:Error)=>void=()=>{};
    const interrupted=new Promise<never>((_,reject)=>{rejectStop=reject;});
    const stop=(code:string)=>{if(stopped)return;stopped=code;controller.abort();rejectStop(new BitcoinReadError(code));};
    const abort=()=>stop('BTC_REQUEST_CANCELLED');
    const current=()=>{if(stopped)return fail(stopped);if(signal?.aborted)return fail('BTC_REQUEST_CANCELLED');guard();};
    const boundary=async<T>(promise:Promise<T>):Promise<T>=>{current();const value=await Promise.race([promise,interrupted]);current();return value;};
    const get=async(path:string,json:boolean)=>{
      current();const url=source+path;
      const response=await fetchImpl(url,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:json?'application/json':'text/plain'},signal:controller.signal});current();
      if(response.status!==200||response.redirected||response.url&&response.url!==url)return fail('BTC_HTTP_RESPONSE');
      const declared=response.headers.get('content-length');if(declared!==null&&(! /^(0|[1-9][0-9]*)$/.test(declared)||BigInt(declared)>1000000n))return fail('BTC_RESPONSE_SIZE');
      const mime=(response.headers.get('content-type')??'').split(';')[0]!.trim().toLowerCase();
      if(json?mime!=='application/json':!['text/plain','application/octet-stream'].includes(mime))return fail('BTC_HTTP_RESPONSE');
      let text:string;
      if(response.body?.getReader){
        const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
        try{
          while(true){const chunk=await boundary(reader.read());if(chunk.done)break;if(!(chunk.value instanceof Uint8Array))return fail('BTC_HTTP_RESPONSE');size+=chunk.value.byteLength;if(size>MAX_BODY)return fail('BTC_RESPONSE_SIZE');chunks.push(chunk.value)}
          const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength}
          try{text=toUtf8String(bytes).replace(/^\uFEFF/,'')}catch{return fail('BTC_HTTP_RESPONSE')}
        }finally{void reader.cancel().catch(()=>{});}
      }else{
        // Text-only RN transports cannot enforce a streaming cap. Check exact
        // UTF-8 bytes immediately after the same guarded, cancellable await.
        text=await boundary(response.text());if(text.length>MAX_BODY)return fail('BTC_RESPONSE_SIZE');
        let bytes:Uint8Array;try{bytes=toUtf8Bytes(text)}catch{return fail('BTC_HTTP_RESPONSE')}
        if(bytes.byteLength>MAX_BODY)return fail('BTC_RESPONSE_SIZE');
      }
      current();
      if(!json)return text.trim();try{return JSON.parse(text) as unknown;}catch{return fail('BTC_UTXO_RESPONSE');}
    };
    const run=async()=>{
      current();if(await get('/block-height/0',false)!==expected.genesis)return fail('BTC_PROVIDER_NETWORK_MISMATCH');
      const rows=await get(`/address/${address}/utxo`,true);
      if(!Array.isArray(rows)||rows.length>10000)return fail('BTC_UTXO_RESPONSE');
      const seen=new Set<string>();let confirmed=0n,unconfirmed=0n;
      for(const row of rows){
        if(!row||typeof row!=='object'||typeof row.txid!=='string'||! /^[0-9a-f]{64}$/.test(row.txid)||typeof row.status?.confirmed!=='boolean')return fail('BTC_UTXO_RESPONSE');
        const vout=integer(row.vout,4294967295n),value=integer(row.value),key=`${row.txid}:${vout}`;
        if(seen.has(key))return fail('BTC_DUPLICATE_OUTPOINT');seen.add(key);
        if(!value)return fail('BTC_UTXO_VALUE');
        if(row.status.confirmed){integer(row.status.block_height,2147483647n);if(typeof row.status.block_hash!=='string'||! /^[0-9a-f]{64}$/.test(row.status.block_hash))return fail('BTC_UTXO_RESPONSE');confirmed+=value;}else unconfirmed+=value;
        if(confirmed+unconfirmed>MAX_SATS)return fail('BTC_AMOUNT_RANGE');
      }
      if(await get('/block-height/0',false)!==expected.genesis)return fail('BTC_PROVIDER_NETWORK_MISMATCH');current();
      const total=confirmed+unconfirmed;
      return Object.freeze({family:'bitcoin' as const,network:id,address,source,genesis:expected.genesis,unit:'sat' as const,symbol:'BTC' as const,decimals:8 as const,confirmedSats:confirmed.toString(),unconfirmedSats:unconfirmed.toString(),totalSats:total.toString(),confirmedBTC:formatBitcoinSats(confirmed.toString()),unconfirmedBTC:formatBitcoinSats(unconfirmed.toString()),totalBTC:formatBitcoinSats(total.toString()),utxoCount:rows.length,verification:'provider-reported-not-spv' as const,watchOnly:true as const,signingSupported:false as const,broadcastSupported:false as const});
    };
    signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>stop('BTC_REQUEST_TIMEOUT'),this.timeoutMs);
    try{return await Promise.race([run(),interrupted]);}
    catch(error){if(error instanceof BitcoinReadError)throw error;if(stopped)fail(stopped);if(signal?.aborted)fail('BTC_REQUEST_CANCELLED');if(error instanceof Error&&'code' in error)throw error;return fail('BTC_READ_UNAVAILABLE');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
  }
}
