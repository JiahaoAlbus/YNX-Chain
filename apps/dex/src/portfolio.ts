import { evmAddressFromYNX } from '@ynx-chain/wallet-auth/src/crypto.js';

const BASE=(import.meta.env.VITE_DEX_GATEWAY_URL||import.meta.env.VITE_DEX_API_URL||'').replace(/\/$/,'');
const SOURCE='ynx-consensus-abci';
const VERSION='abci-state-v13';
export type NativeAssetBalance={assetId:string;symbol:string;decimals:number;amountAtomic:string};
export type NativeLiquidityPosition={poolId:string;asset0:string;asset1:string;shares:string;totalShares:string;claim0Atomic:string;claim1Atomic:string;blockHeight:number};
export type NativePortfolio={address:string;balanceAtomic:string;stakedAtomic:string;nonce:string;assets:NativeAssetBalance[];positions:NativeLiquidityPosition[];readAt:string;source:string;version:string;atomicSnapshot:false};
export class PortfolioError extends Error {
  constructor(public code:'INVALID_ACCOUNT'|'UNAVAILABLE'|'INVALID_RESPONSE'){super(code);}
}
const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new PortfolioError('INVALID_RESPONSE');
  return value as Record<string,unknown>;
};
/** Same address payload, not a signature, authorization, custody or EVM/native unit conversion. */
export function nativeLedgerAddress(account:string):string {
  if(/^0x[0-9a-fA-F]{40}$/.test(account))return account.toLowerCase();
  try{return evmAddressFromYNX(account);}catch{throw new PortfolioError('INVALID_ACCOUNT');}
}
function integer(value:unknown):string {
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return String(value);
  if(typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n)return value;
  throw new PortfolioError('INVALID_RESPONSE');
}
const assetId=(value:unknown)=>{
  if(typeof value!=='string'||! /^(YNXT|[a-z][a-z0-9_-]{2,63})$/.test(value))throw new PortfolioError('INVALID_RESPONSE');
  return value;
};
async function get(path:string,signal?:AbortSignal){
  let response:Response;
  try{response=await fetch(`${BASE}${path}`,{signal,credentials:'omit',headers:{Accept:'application/json'}});}
  catch(error){if(signal?.aborted)throw error;throw new PortfolioError('UNAVAILABLE');}
  if(!response.ok)throw new PortfolioError('UNAVAILABLE');
  try{return object(await response.json());}catch{throw new PortfolioError('INVALID_RESPONSE');}
}
function collection(body:Record<string,unknown>,key:string){
  if(body.source!==SOURCE||body.version!==VERSION||body.failure!==false||!Array.isArray(body[key])||object(body.coverage).complete!==true)throw new PortfolioError('INVALID_RESPONSE');
  return body[key] as unknown[];
}
/** Public committed ledger reads. Missing routes or partial coverage are never a zero balance. */
export async function loadNativePortfolio(account:string,signal?:AbortSignal):Promise<NativePortfolio>{
  const address=nativeLedgerAddress(account);
  const [accountBody,balanceBody,assetBody,poolBody]=await Promise.all([
    get(`/accounts/${address}`,signal),get(`/dex/balances/${address}`,signal),get('/dex/assets',signal),get('/dex/pools',signal),
  ]);
  if(accountBody.address!==address||balanceBody.address!==address)throw new PortfolioError('INVALID_RESPONSE');
  const balanceAtomic=integer(accountBody.balance),stakedAtomic=integer(accountBody.staked),nonce=integer(accountBody.nonce);
  const metadata=new Map<string,{symbol:string;decimals:number}>([['YNXT',{symbol:'YNXT',decimals:0}]]);
  for(const raw of collection(assetBody,'assets')){
    const a=object(raw),id=assetId(a.id);
    if(metadata.has(id)||typeof a.symbol!=='string'||a.symbol.length<1||a.symbol.length>32||typeof a.decimals!=='number'||!Number.isInteger(a.decimals)||a.decimals<0||a.decimals>18)throw new PortfolioError('INVALID_RESPONSE');
    metadata.set(id,{symbol:a.symbol,decimals:a.decimals});
  }
  const balances=new Map<string,string>();
  for(const raw of collection(balanceBody,'balances')){
    const b=object(raw),id=assetId(b.assetId);
    if(b.account!==address||id==='YNXT'||balances.has(id)||!metadata.has(id))throw new PortfolioError('INVALID_RESPONSE');
    balances.set(id,integer(b.amount));
  }
  const positions:NativeLiquidityPosition[]=[],seen=new Set<string>();
  for(const raw of collection(poolBody,'pools')){
    const p=object(raw);
    if(typeof p.id!=='string'||!/^dex_[a-z0-9][a-z0-9_-]{2,59}$/.test(p.id)||seen.has(p.id)||!Array.isArray(p.shares))throw new PortfolioError('INVALID_RESPONSE');
    seen.add(p.id);
    const asset0=assetId(p.asset0),asset1=assetId(p.asset1);
    if(!metadata.has(asset0)||!metadata.has(asset1)||asset0===asset1)throw new PortfolioError('INVALID_RESPONSE');
    const totalShares=integer(p.totalShares),reserve0=integer(p.reserve0),reserve1=integer(p.reserve1);
    if(typeof p.blockHeight!=='number'||!Number.isSafeInteger(p.blockHeight)||p.blockHeight<1)throw new PortfolioError('INVALID_RESPONSE');
    let owned=0n,total=0n;const owners=new Set<string>();
    for(const rawShare of p.shares){
      const s=object(rawShare);
      if(typeof s.account!=='string'||!/^0x[0-9a-f]{40}$/.test(s.account)||owners.has(s.account))throw new PortfolioError('INVALID_RESPONSE');
      owners.add(s.account);const shares=BigInt(integer(s.shares));total+=shares;
      if(s.account===address)owned=shares;
    }
    if(total!==BigInt(totalShares))throw new PortfolioError('INVALID_RESPONSE');
    if(owned>0n)positions.push({poolId:p.id,asset0,asset1,shares:String(owned),totalShares,claim0Atomic:String(owned*BigInt(reserve0)/total),claim1Atomic:String(owned*BigInt(reserve1)/total),blockHeight:p.blockHeight});
  }
  return {address,balanceAtomic,stakedAtomic,nonce,assets:[...metadata].map(([id,m])=>({assetId:id,...m,amountAtomic:id==='YNXT'?balanceAtomic:balances.get(id)??'0'})),positions,readAt:new Date().toISOString(),source:SOURCE,version:VERSION,atomicSnapshot:false};
}
export function formatAtomic(amount:string,decimals:number):string {
  const padded=amount.padStart(decimals+1,'0');
  if(!decimals)return padded;
  const tail=padded.slice(-decimals).replace(/0+$/,'');
  return padded.slice(0,-decimals)+(tail?`.${tail}`:'');
}
