import type { Analytics, ChainEvent, FeeSummary, Pool, Position, SpotPrice, Token, TWAP } from "./types";

const BASE = (import.meta.env.VITE_DEX_GATEWAY_URL || import.meta.env.VITE_DEX_API_URL || "").replace(/\/$/, "");
const EXPECTED_VERSION = "abci-state-v13";

type Envelope = { source:string; version:string; failure:boolean; error?:string };
type NativeAsset = { id:string; symbol:string; name:string; decimals:number; issuer?:string; maxSupply?:number; totalSupply?:number; blockHeight?:number; txHash?:string; auditHash?:string };
type NativePool = { id:string; kind:string; asset0:string; asset1:string; reserve0:number; reserve1:number; feeBps:number; totalShares:number; blockHeight:number; updatedAt:string; txHash:string; auditHash:string };
type NativeEvent = { id:string; type:string; poolId?:string; signer:string; amount0?:number; amount1?:number; blockHeight:number; occurredAt:string; txHash:string; auditHash:string };

async function request<T extends Envelope>(path:string, signal?:AbortSignal):Promise<T> {
  const response = await fetch(`${BASE}${path}`, { signal, headers:{Accept:"application/json"}, credentials:"omit" });
  const body = await response.json().catch(()=>null) as T|null;
  if (!response.ok || !body || body.failure) throw new Error(body?.error || `DEX consensus gateway returned ${response.status}.`);
  if (body.source !== "ynx-consensus-abci" || body.version !== EXPECTED_VERSION) throw new Error("DEX gateway is not serving committed consensus state v13.");
  return body;
}

const ynxt:Token = {chainId:6423,address:"YNXT",symbol:"YNXT",name:"YNX Testnet",decimals:0,standard:"YNX-consensus-asset",reviewStatus:"consensus-committed-testnet",issuer:"protocol",totalSupply:"",maxSupply:"",updatedBlock:0,txHash:"",auditHash:""};
const token=(asset:NativeAsset):Token=>({chainId:6423,address:asset.id,symbol:asset.symbol,name:asset.name,decimals:asset.decimals,standard:"YNX-consensus-asset",reviewStatus:"consensus-committed-testnet",issuer:asset.issuer||"protocol",totalSupply:String(asset.totalSupply??""),maxSupply:String(asset.maxSupply??""),updatedBlock:asset.blockHeight||0,txHash:asset.txHash||"",auditHash:asset.auditHash||""});
const pool=(value:NativePool):Pool=>({address:value.id,token0:value.asset0,token1:value.asset1,reserve0:String(value.reserve0),reserve1:String(value.reserve1),contractVersion:"ynx-consensus-cpmm-v13",feeBps:value.feeBps,totalShares:String(value.totalShares),updatedBlock:value.blockHeight,updatedAt:value.updatedAt,txHash:value.txHash,auditHash:value.auditHash});
const event=(value:NativeEvent):ChainEvent=>({id:value.id,type:value.type,pool:value.poolId||"",account:value.signer,amount0:String(value.amount0||0),amount1:String(value.amount1||0),fee0:"0",fee1:"0",blockNumber:value.blockHeight,txHash:value.txHash,timestamp:value.occurredAt,auditHash:value.auditHash});

export async function loadDexSnapshot(signal?:AbortSignal){
  const [assetEnvelope,poolEnvelope,eventEnvelope] = await Promise.all([
    request<Envelope&{assets:NativeAsset[]}>("/dex/assets",signal),
    request<Envelope&{pools:NativePool[]}>("/dex/pools",signal),
    request<Envelope&{events:NativeEvent[]}>("/dex/events",signal),
  ]);
  const tokens=[ynxt,...assetEnvelope.assets.map(token)];
  const pools=poolEnvelope.pools.map(pool);
  const events=eventEnvelope.events.map(event).sort((a,b)=>b.blockNumber-a.blockNumber);
  const latestBlock=Math.max(0,...pools.map(item=>item.updatedBlock),...events.map(item=>item.blockNumber),...tokens.map(item=>item.updatedBlock));
  const analytics:Analytics={source:assetEnvelope.source,version:assetEnvelope.version,indexedEvents:events.length,pools:pools.length,swaps:events.filter(item=>item.type.startsWith("dex_swap_")).length,liquidityEvents:events.filter(item=>item.type.startsWith("dex_liquidity_")).length,latestBlock};
  const prices:SpotPrice[]=pools.filter(item=>BigInt(item.reserve0)>0n&&BigInt(item.reserve1)>0n).map(item=>({pool:item.address,token0:item.token0,token1:item.token1,price0Numerator:item.reserve1,price0Denominator:item.reserve0,price1Numerator:item.reserve0,price1Denominator:item.reserve1,updatedBlock:item.updatedBlock}));
  return {pools,tokens,events,analytics,prices,twap:[] as TWAP[],fees:[] as FeeSummary[]};
}

export const dexApi = {
  snapshot:loadDexSnapshot,
  positions:async(account:string,_sessionBinding:string,signal?:AbortSignal)=>{
    const response=await request<Envelope&{pools:NativePool[]}>("/dex/pools",signal);
    const items:Position[]=response.pools.flatMap(item=>[]);
    void account;
    return {items};
  },
};
