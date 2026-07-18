import { useCallback, useEffect, useState } from "react";
import { dexApi } from "./api";
import type { Analytics, ChainEvent, Loadable, Pool } from "./types";
export function useDexData(){
 const [data,setData]=useState<Loadable<{pools:Pool[];events:ChainEvent[];analytics:Analytics}>>({state:"loading"});
 const load=useCallback(()=>{const controller=new AbortController();setData({state:"loading"});Promise.all([dexApi.pools(controller.signal),dexApi.events(controller.signal),dexApi.analytics(controller.signal)]).then(([pools,events,analytics])=>setData({state:"ready",data:{pools:pools.items,events:events.items,analytics},stale:false})).catch((error)=>{if(error.name!=="AbortError")setData({state:"error",message:error instanceof Error?error.message:"DEX service unavailable"})});return()=>controller.abort()},[]);
 useEffect(()=>load(),[load]);
 return {data,retry:load};
}
