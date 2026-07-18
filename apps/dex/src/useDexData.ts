import { useCallback, useEffect, useState } from "react";
import { dexApi } from "./api";
import type { Analytics, ChainEvent, FeeSummary, Loadable, Pool, SpotPrice, Token, TWAP } from "./types";
export function useDexData(){
 const [data,setData]=useState<Loadable<{pools:Pool[];tokens:Token[];events:ChainEvent[];analytics:Analytics;prices:SpotPrice[];twap:TWAP[];fees:FeeSummary[]}>>({state:"loading"});
 const load=useCallback(()=>{const controller=new AbortController();setData({state:"loading"});Promise.all([dexApi.pools(controller.signal),dexApi.tokens(controller.signal),dexApi.events(controller.signal),dexApi.analytics(controller.signal),dexApi.prices(controller.signal),dexApi.twap(controller.signal),dexApi.fees(controller.signal)]).then(([pools,tokens,events,analytics,prices,twap,fees])=>setData({state:"ready",data:{pools:pools.items,tokens:tokens.items,events:events.items,analytics,prices:prices.items,twap:twap.items,fees:fees.items},stale:false})).catch((error)=>{if(error.name!=="AbortError")setData({state:"error",message:error instanceof Error?error.message:"DEX service unavailable"})});return()=>controller.abort()},[]);
 useEffect(()=>load(),[load]);
 return {data,retry:load};
}
