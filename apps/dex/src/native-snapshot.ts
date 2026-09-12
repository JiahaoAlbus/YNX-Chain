import { evmAddressFromYNX } from '@ynx-chain/wallet-auth/src/crypto.js';

// Product consumer of Core 28d30b4b. Not another ledger or signing SDK.
export const NATIVE_SOURCE='authoritative chain-native YNX Testnet state';
export const NATIVE_SCHEMA='ynx-native-finance-snapshot-v1';
const BASE=(import.meta.env.VITE_DEX_GATEWAY_URL||import.meta.env.VITE_DEX_API_URL||'').replace(/\/$/,'');
const I64=9223372036854775807n,U64=18446744073709551615n;
export class NativeSnapshotError extends Error {
  constructor(public code:'INVALID_ACCOUNT'|'UNAVAILABLE'|'INVALID_RESPONSE'|'STALE'){super(code);}
}
const invalid=():never=>{throw new NativeSnapshotError('INVALID_RESPONSE');};
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:invalid();
const list=(v:unknown):unknown[]=>Array.isArray(v)?v:invalid();
const text=(v:unknown,max=128):string=>typeof v==='string'&&v.length>0&&v.length<=max?v:invalid();
const matches=(v:unknown,re:RegExp):string=>typeof v==='string'&&re.test(v)?v:invalid();
const address=(v:unknown)=>matches(v,/^0x[0-9a-f]{40}$/);
const hash=(v:unknown)=>matches(v,/^[0-9a-f]{64}$/);
const assetID=(v:unknown)=>matches(v,/^(YNXT|[a-z][a-z0-9_-]{2,63})$/);
const poolID=(v:unknown)=>matches(v,/^dex_[a-z0-9][a-z0-9_-]{2,59}$/);
const count=(v:unknown,max=Number.MAX_SAFE_INTEGER)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max?v:invalid();
export function nativeInteger(v:unknown,max=I64):string {
  if(typeof v!=='string'||! /^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>max)return invalid();
  return v;
}
/** Address payload equivalence is not permission to sign, spend or assume custody. */
export function nativeLedgerAddress(v:string):string {
  if(/^0x[0-9a-fA-F]{40}$/.test(v))return v.toLowerCase();
  try{return evmAddressFromYNX(v);}catch{throw new NativeSnapshotError('INVALID_ACCOUNT');}
}
function timestamp(v:unknown):string {
  const s=matches(v,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/);
  return Number.isFinite(Date.parse(s))?s:invalid();
}
function anchor(v:Record<string,unknown>){
  const blockHeight=nativeInteger(v.blockHeight,U64),blockHash=v.blockHash===''?'':hash(v.blockHash);
  if(blockHeight!=='0'&&blockHash==='')invalid();
  const txHash=matches(v.txHash,/^0x[0-9a-f]{64}$/);
  if(v.transactionHash!==txHash)invalid();
  return {blockHeight,blockHash,txHash,auditHash:hash(v.auditHash)};
}
export type NativeAsset={id:string;symbol:string;name:string;decimals:number;native:boolean;issuer?:string;maxSupply?:string;totalSupply?:string;blockHeight?:string;txHash?:string;auditHash?:string};
export type NativePool=ReturnType<typeof parsePool>;
export type NativeEvent=ReturnType<typeof parseEvent>;
function parsePool(raw:unknown,assets:Map<string,NativeAsset>){
  const v=obj(raw),id=poolID(v.id),asset0=assetID(v.asset0),asset1=assetID(v.asset1);
  if(v.kind!=='ynx-cpmm-v1'||!assets.has(asset0)||!assets.has(asset1)||asset0===asset1)invalid();
  const reserve0=nativeInteger(v.reserve0),reserve1=nativeInteger(v.reserve1),totalShares=nativeInteger(v.totalShares),feeBps=count(v.feeBps,1000);
  if(feeBps===0)invalid();
  const owners=new Set<string>();let sum=0n;
  const shares=list(v.shares).map(raw=>{
    const s=obj(raw),owner=address(s.account),amount=nativeInteger(s.shares);
    if(owners.has(owner))invalid();owners.add(owner);sum+=BigInt(amount);
    return {account:owner,shares:amount};
  });
  if(sum!==BigInt(totalShares))invalid();
  return {id,asset0,asset1,reserve0,reserve1,totalShares,feeBps,shares,...anchor(v)};
}
function parseEvent(raw:unknown,assets:Map<string,NativeAsset>,pools:Set<string>){
  const v=obj(raw),type=matches(v.type,/^dex_(asset_create|pool_create|liquidity_add|liquidity_remove|swap_exact_input|swap_exact_output)$/);
  const asset0=assetID(v.asset0),asset1=v.asset1===''?'':assetID(v.asset1),poolId=v.poolId===''?'':poolID(v.poolId);
  if(!assets.has(asset0)||(asset1&&!assets.has(asset1))||(poolId&&!pools.has(poolId)))invalid();
  if(type!=='dex_asset_create'&&(!poolId||!asset1))invalid();
  const a=anchor(v),stage=v.stage;
  if(stage!=='pending'&&stage!=='included')invalid();
  if((stage==='included')!==(a.blockHeight!=='0'&&a.blockHash!==''))invalid();
  return {id:text(v.id),type,poolId,asset0,asset1,signer:address(v.signer),amount0:nativeInteger(v.amount0),amount1:nativeInteger(v.amount1),shares:nativeInteger(v.shares),occurredAt:timestamp(v.occurredAt),stage:stage as 'pending'|'included',...a};
}
export function parseNativeSnapshot(raw:unknown,requestedAccount?:string,now=Date.now()){
  const v=obj(raw),coverage=obj(v.coverage);
  if(v.schemaVersion!==NATIVE_SCHEMA||v.source!==NATIVE_SOURCE||v.chainId!=='6423'||v.integerEncoding!=='decimal-string'||v.nativeUnit!=='whole-YNXT'||v.evmWeiPerYNXT!=='1000000000000000000'||v.nonceRule!=='current-plus-one'||v.signedActionCurve!=='secp256k1'||v.atomic!==true||v.stateScope!=='authoritative-current-including-pending'||v.consensusFinality!==false||v.appHash!==null||v.transactionStatusPath!=='/v1/native-transactions/{hash}')invalid();
  if(coverage.complete!==true||coverage.assets!==true||coverage.lpShares!==true||coverage.events!==true||coverage.balances!==Boolean(requestedAccount))invalid();
  const asOf=timestamp(v.asOf);
  if(v.updatedAt!==asOf)invalid();
  if(now-Date.parse(asOf)>15*60_000||Date.parse(asOf)-now>30_000)throw new NativeSnapshotError('STALE');
  const snapshotId=matches(v.snapshotId,/^sha256:[0-9a-f]{64}$/),blockHeight=nativeInteger(v.blockHeight,U64),blockHash=hash(v.blockHash);
  const pendingTransactionCount=count(v.pendingTransactionCount);
  let durableCheckpoint:{height:string;blockHash:string;snapshotIntegrity:string;scope:'local-snapshot'}|null=null;
  if(v.durableCheckpoint!==null){
    const d=obj(v.durableCheckpoint);if(d.scope!=='local-snapshot')invalid();
    durableCheckpoint={height:nativeInteger(d.height,U64),blockHash:hash(d.blockHash),snapshotIntegrity:hash(d.snapshotIntegrity),scope:'local-snapshot'};
  }
  const assets=new Map<string,NativeAsset>();
  for(const raw of list(v.assets)){
    const a=obj(raw),id=assetID(a.id),symbol=text(a.symbol,32),name=text(a.name),decimals=count(a.decimals,18);
    if(assets.has(id))invalid();
    if(id==='YNXT'){
      if(a.native!==true||decimals!==0||symbol!=='YNXT')invalid();
      assets.set(id,{id,symbol,name,decimals,native:true});
    }else{
      if(a.native===true)invalid();
      const maxSupply=nativeInteger(a.maxSupply),totalSupply=nativeInteger(a.totalSupply);
      if(BigInt(totalSupply)>BigInt(maxSupply))invalid();
      assets.set(id,{id,symbol,name,decimals,native:false,issuer:address(a.issuer),maxSupply,totalSupply,...anchor(a)});
    }
  }
  if(!assets.has('YNXT'))invalid();
  let account:{address:string;exists:boolean;balance:string;staked:string;nonce:string;nextNonce:string|null}|null=null;
  if(requestedAccount){
    const a=obj(v.account),owner=address(a.address),nonce=nativeInteger(a.nonce,U64);
    if(owner!==nativeLedgerAddress(requestedAccount)||typeof a.exists!=='boolean')invalid();
    const nextNonce=a.nextNonce===null?null:nativeInteger(a.nextNonce,U64);
    if(nextNonce!==(BigInt(nonce)===U64?null:String(BigInt(nonce)+1n)))invalid();
    const observed={address:owner,exists:a.exists as boolean,balance:nativeInteger(a.balance),staked:nativeInteger(a.staked),nonce,nextNonce};
    if(!observed.exists&&(observed.balance!=='0'||observed.staked!=='0'||nonce!=='0'))invalid();
    account=observed;
  }else if(v.account!==null)invalid();
  const balances=new Map<string,string>();
  for(const raw of list(v.balances)){
    const b=obj(raw),id=assetID(b.assetId);
    if(!account||b.account!==account.address||!assets.has(id)||balances.has(id))invalid();
    balances.set(id,nativeInteger(b.amount));
  }
  if(account&&(balances.size!==assets.size||balances.get('YNXT')!==account.balance))invalid();
  const poolIds=new Set<string>(),pools=list(v.pools).map(raw=>{
    const p=parsePool(raw,assets);if(poolIds.has(p.id))invalid();poolIds.add(p.id);return p;
  });
  const eventIds=new Set<string>(),events=list(v.events).map(raw=>{
    const e=parseEvent(raw,assets,poolIds);if(eventIds.has(e.id))invalid();eventIds.add(e.id);return e;
  });
  return {schemaVersion:NATIVE_SCHEMA,source:NATIVE_SOURCE,atomic:true as const,stateScope:'authoritative-current-including-pending' as const,consensusFinality:false as const,appHash:null,snapshotId,asOf,blockHeight,blockHash,pendingTransactionCount,durableCheckpoint,account,assets:[...assets.values()],balances,pools,events};
}
export type NativeSnapshot=ReturnType<typeof parseNativeSnapshot>;
export async function loadNativeSnapshot(account?:string,signal?:AbortSignal):Promise<NativeSnapshot>{
  const owner=account?nativeLedgerAddress(account):undefined;
  let response:Response;
  try{response=await fetch(`${BASE}/v1/native-snapshot${owner?`?account=${owner}`:''}`,{signal,credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}});}
  catch(error){if(signal?.aborted)throw error;throw new NativeSnapshotError('UNAVAILABLE');}
  if(!response.ok)throw new NativeSnapshotError('UNAVAILABLE');
  let body:unknown;try{body=await response.json();}catch{throw new NativeSnapshotError('INVALID_RESPONSE');}
  return parseNativeSnapshot(body,owner);
}
