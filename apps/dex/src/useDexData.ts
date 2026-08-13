import { useCallback, useEffect, useState } from "react";
import { dexApi } from "./api";
import type { Analytics, Candle, ChainEvent, FeeSummary, Loadable, Pool, SpotPrice, Token, TWAP } from "./types";
export function useDexData(){
 const [data,setData]=useState<Loadable<{pools:Pool[];tokens:Token[];events:ChainEvent[];analytics:Analytics;prices:SpotPrice[];twap:TWAP[];fees:FeeSummary[];candles:Candle[]}>>({state:"loading"});
 const load=useCallback(()=>{const controller=new AbortController();setData({state:"loading"});(async()=>{try{const [pools,tokens,events,analytics,prices,twap,fees]=await Promise.all([dexApi.pools(controller.signal),dexApi.tokens(controller.signal),dexApi.events(controller.signal),dexApi.analytics(controller.signal),dexApi.prices(controller.signal),dexApi.twap(controller.signal),dexApi.fees(controller.signal)]);const candles=pools.items.length?(await dexApi.candles(pools.items[0].address,60,controller.signal)).items:[];setData({state:"ready",data:{pools:pools.items,tokens:tokens.items,events:events.items,analytics,prices:prices.items,twap:twap.items,fees:fees.items,candles},stale:false})}catch(error){if(error instanceof Error&&error.name!=="AbortError")setData({state:"error",message:error.message||"DEX service unavailable"})}})();return()=>controller.abort()},[]);
 useEffect(()=>load(),[load]);
 useEffect(()=>{const reconnect=()=>load();window.addEventListener("online",reconnect);return()=>window.removeEventListener("online",reconnect)},[load]);
 return {data,retry:load};
}
