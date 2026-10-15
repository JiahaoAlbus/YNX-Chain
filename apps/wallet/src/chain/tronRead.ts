import {getBytes, hexlify, sha256, toUtf8Bytes, toUtf8String} from 'ethers';

/** Watch-only public reads. No default RPC, identity derivation, permissions,
 * signing, broadcasting, storage or clipboard capability is exposed. */
export type TronReadConfig = Readonly<{network:'mainnet'|'shasta'|'nile';genesisBlockId:string;rpcURL:string}>;
export type TronReadOptions = Readonly<{fetchImpl?:typeof fetch;timeoutMs?:number;assertCurrent?:()=>void}>;
export type TronReadInput = Readonly<{address:string;contract?:string;expectedDecimals?:number}>;
export type TronReadResult = Readonly<{family:'tron';network:TronReadConfig['network'];genesisBlockId:string;
  source:Readonly<{rpcURL:string;verification:'provider-reported-not-consensus'}>;address:string;hexAddress:string;
  trx:Readonly<{sun:string;display:string;activated:boolean}>;
  token?:Readonly<{contract:string;hexContract:string;name:string;symbol:string;decimals:number;units:string;display:string}>}>;
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX64=(1n<<63n)-1n, MAX256=(1n<<256n)-1n, MAX_BODY=32768;
function fail(code:string):never{throw Object.assign(new Error(code),{code});}
function object(value:unknown):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.hasOwn(value,'Error'))fail('TRON_READ_RESPONSE_INVALID');return value as Record<string,any>;}
function uint(value:unknown,max=MAX256):bigint{
  if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0)fail('TRON_READ_INTEGER_INVALID');value=String(value);}
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||value.length>78)fail('TRON_READ_INTEGER_INVALID');
  const n=BigInt(value);if(n>max)fail('TRON_READ_INTEGER_INVALID');return n;
}
function encode58(bytes:Uint8Array):string{let n=BigInt(hexlify(bytes)),s='';while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}for(const b of bytes){if(b)break;s='1'+s;}return s;}
function checksum(payload:Uint8Array){return getBytes(sha256(getBytes(sha256(payload)))).slice(0,4);}
export function tronPublicAddress(value:string):Readonly<{hex:string;address:string}>{
  if(typeof value!=='string')fail('TRON_READ_ADDRESS_INVALID');let bytes:Uint8Array;
  if(/^41[0-9a-fA-F]{40}$/.test(value))bytes=getBytes('0x'+value);
  else{
    if(!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value))fail('TRON_READ_ADDRESS_INVALID');
    let n=0n;for(const c of value)n=n*58n+BigInt(alphabet.indexOf(c));const h=n.toString(16).padStart(50,'0');
    if(h.length!==50)fail('TRON_READ_ADDRESS_INVALID');const decoded=getBytes('0x'+h);bytes=decoded.slice(0,21);
    if(bytes[0]!==65||hexlify(checksum(bytes))!==hexlify(decoded.slice(21))||encode58(decoded)!==value)fail('TRON_READ_ADDRESS_INVALID');
  }
  if(bytes[0]!==65||bytes.slice(1).every(b=>b===0))fail('TRON_READ_ADDRESS_INVALID');
  const combined=new Uint8Array(25);combined.set(bytes);combined.set(checksum(bytes),21);
  return Object.freeze({hex:hexlify(bytes).slice(2),address:encode58(combined)});
}
export function tronReadDisplay(units:string,decimals=6):string{
  if(!Number.isInteger(decimals)||decimals<0||decimals>255)fail('TRON_READ_DECIMALS_INVALID');const raw=uint(units).toString();
  if(!decimals)return raw;const s=raw.padStart(decimals+1,'0'),fraction=s.slice(-decimals).replace(/0+$/,'');return s.slice(0,-decimals)+(fraction?'.'+fraction:'');
}
function constant(body:unknown):string{
  const b=object(body),result=object(b.result);if(result.result!==true||(result.code!==undefined&&result.code!==0&&result.code!=='SUCCESS')||!Array.isArray(b.constant_result)||b.constant_result.length!==1)fail('TRON_READ_CONTRACT_FAILED');
  if(b.transaction?.ret!==undefined){const ret=b.transaction.ret;if(!Array.isArray(ret)||ret.length!==1)fail('TRON_READ_CONTRACT_FAILED');const r=object(ret[0]);if((r.ret===undefined&&r.contractRet===undefined)||(r.ret!==undefined&&!['SUCCESS','SUCESS'].includes(r.ret))||(r.contractRet!==undefined&&r.contractRet!=='SUCCESS'))fail('TRON_READ_CONTRACT_FAILED');}
  const value=b.constant_result[0];if(typeof value!=='string'||value.length>1024||!/^(?:[0-9a-fA-F]{2})+$/.test(value))fail('TRON_READ_ABI_INVALID');return value.toLowerCase();
}
function word(body:unknown):bigint{const s=constant(body);if(s.length!==64)fail('TRON_READ_ABI_INVALID');return BigInt('0x'+s);}
function text(body:unknown,field:'name'|'symbol'):string{
  const encoded=constant(body),max=field==='name'?128:32,maxPoints=field==='name'?64:16;
  if(encoded.length<128||BigInt('0x'+encoded.slice(0,64))!==32n)fail('TRON_READ_ABI_INVALID');
  const size=BigInt('0x'+encoded.slice(64,128));if(size<1n||size>BigInt(max))fail('TRON_READ_METADATA_INVALID');const n=Number(size);
  if(encoded.length!==(64+Math.ceil(n/32)*32)*2||!/^0*$/.test(encoded.slice(128+n*2)))fail('TRON_READ_ABI_INVALID');
  let value:string;try{value=toUtf8String(getBytes('0x'+encoded.slice(128,128+n*2)));}catch{fail('TRON_READ_METADATA_INVALID');}
  if(!value||value.trim()!==value||[...value].length>maxPoints||/[\p{Cc}\p{Cf}<>]/u.test(value))fail('TRON_READ_METADATA_INVALID');return value;
}
function configuration(input:TronReadConfig):TronReadConfig{
  if(!input||!['mainnet','shasta','nile'].includes(input.network)||typeof input.genesisBlockId!=='string'||!/^[0-9a-f]{64}$/.test(input.genesisBlockId)||/^0+$/.test(input.genesisBlockId)||typeof input.rpcURL!=='string'||input.rpcURL.length>2048||/[\\%?#\s]/.test(input.rpcURL)||/\/(?:\.|\.\.)(?:\/|$)/.test(input.rpcURL))fail('TRON_READ_CONFIG_INVALID');
  let url:URL;try{url=new URL(input.rpcURL);}catch{fail('TRON_READ_CONFIG_INVALID');}
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||! /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)||/\.(?:local|localhost|internal|home|test|invalid)$/.test(url.hostname)||!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(url.pathname))fail('TRON_READ_CONFIG_INVALID');
  // RN fetch cannot pin DNS/socket IP. This is explicit trusted public endpoint
  // configuration, not a generic arbitrary URL proxy or network attestation.
  return Object.freeze({network:input.network,genesisBlockId:input.genesisBlockId,rpcURL:url.href.replace(/\/$/,'')});
}
export function createTronReader(input:TronReadConfig,options:TronReadOptions={}){
  const config=configuration(input),fetchImpl=options.fetchImpl??fetch,assertCurrent=options.assertCurrent??(()=>{}),timeoutMs=options.timeoutMs??12000;
  if(typeof fetchImpl!=='function'||typeof assertCurrent!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)fail('TRON_READ_CONFIG_INVALID');
  return Object.freeze({async read(input:TronReadInput,extra:{signal?:AbortSignal}={}):Promise<TronReadResult>{
    const owner=tronPublicAddress(input.address),contract=input.contract===undefined?null:tronPublicAddress(input.contract),expected=input.expectedDecimals;
    if(expected!==undefined&&(!contract||!Number.isInteger(expected)||expected<0||expected>255))fail('TRON_READ_DECIMALS_INVALID');
    const controller=new AbortController(),signal=extra.signal;let retired=false,timedOut=false;
    if(signal!==undefined&&(typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))fail('TRON_READ_SIGNAL_INVALID');
    const assert=()=>{if(timedOut)fail('TRON_READ_TIMEOUT');if(retired||signal?.aborted)fail('TRON_READ_CANCELLED');assertCurrent();};
    let stop!:(cause:Error)=>void;const cancellation=new Promise<never>((_,reject)=>{stop=reject;});
    const abort=()=>{retired=true;controller.abort();stop(Object.assign(new Error('TRON_READ_CANCELLED'),{code:'TRON_READ_CANCELLED'}));};
    const timer=setTimeout(()=>{timedOut=true;controller.abort();stop(Object.assign(new Error('TRON_READ_TIMEOUT'),{code:'TRON_READ_TIMEOUT'}));},timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    const boundary=async<T>(promise:Promise<T>):Promise<T>=>{assert();const value=await Promise.race([promise,cancellation]);assert();return value;};
    const read=async(route:string,body:object)=>{
      assert();let response:Response;try{response=await boundary(fetchImpl(config.rpcURL+route,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body),signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'}));}catch(error){assert();fail('TRON_READ_UNAVAILABLE');}
      assert();const type=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();const length=response.headers.get('content-length');
      if(response.status!==200||response.redirected||type!=='application/json'||(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>MAX_BODY)))fail('TRON_READ_RESPONSE_INVALID');
      // Stream-cap when supported; older RN fetch text fallback is checked
      // immediately after completion, with the same deadline/cancellation guard.
      let raw='';if(response.body?.getReader){const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
        try{while(true){const chunk=await boundary(reader.read());if(chunk.done)break;size+=chunk.value.byteLength;if(size>MAX_BODY)fail('TRON_READ_RESPONSE_TOO_LARGE');chunks.push(chunk.value);}const bytes=new Uint8Array(size);let at=0;for(const b of chunks){bytes.set(b,at);at+=b.length;}try{raw=toUtf8String(bytes);}catch{fail('TRON_READ_RESPONSE_INVALID');}}
        finally{void reader.cancel().catch(()=>{});}
      }else{raw=await boundary(response.text());if(raw.length>MAX_BODY||toUtf8Bytes(raw).length>MAX_BODY)fail('TRON_READ_RESPONSE_TOO_LARGE');}
      assert();try{return object(JSON.parse(raw));}catch{fail('TRON_READ_RESPONSE_INVALID');}
    };
    try{
      assert();const genesis=await read('/wallet/getblockbynum',{num:0}),header=object(object(genesis.block_header).raw_data);
      if(genesis.blockID!==config.genesisBlockId||uint(header.number??0)!==0n)fail('TRON_READ_NETWORK_MISMATCH');
      const account=await read('/wallet/getaccount',{address:owner.hex,visible:false});let sun='0',activated=false;
      if(Object.keys(account).length){if(tronPublicAddress(account.address).hex!==owner.hex)fail('TRON_READ_ACCOUNT_MISMATCH');sun=uint(account.balance??0,MAX64).toString();activated=true;}
      let token:TronReadResult['token'];if(contract){
        const call=(selector:string,parameter='')=>read('/wallet/triggerconstantcontract',{owner_address:owner.hex,contract_address:contract.hex,function_selector:selector,parameter,visible:false});
        const d=word(await call('decimals()'));if(d>255n)fail('TRON_READ_DECIMALS_INVALID');const decimals=Number(d);if(expected!==undefined&&expected!==decimals)fail('TRON_READ_DECIMALS_MISMATCH');
        const symbol=text(await call('symbol()'),'symbol'),name=text(await call('name()'),'name'),units=word(await call('balanceOf(address)',owner.hex.slice(2).padStart(64,'0'))).toString();
        token=Object.freeze({contract:contract.address,hexContract:contract.hex,name,symbol,decimals,units,display:tronReadDisplay(units,decimals)});
      }
      assert();return Object.freeze({family:'tron',network:config.network,genesisBlockId:config.genesisBlockId,source:Object.freeze({rpcURL:config.rpcURL,verification:'provider-reported-not-consensus'}),address:owner.address,hexAddress:owner.hex,trx:Object.freeze({sun,display:tronReadDisplay(sun),activated}),...(token?{token}:{})});
    }finally{retired=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
  }});
}
