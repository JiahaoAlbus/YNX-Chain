import { useCallback, useEffect, useRef, useState } from "react";
import { dexApi } from "./api";
import { NativeSnapshotError } from "./native-snapshot";
import { portfolioCopy } from "./portfolio-i18n";
import type { Analytics, ChainEvent, FeeSummary, Loadable, Locale, Pool, SnapshotProvenance, SpotPrice, Token, TWAP } from "./types";

type DexData={pools:Pool[];tokens:Token[];events:ChainEvent[];analytics:Analytics;provenance:SnapshotProvenance;prices:SpotPrice[];twap:TWAP[];fees:FeeSummary[]};
export function useDexData(locale:Locale="en"){
 const [data,setData]=useState<Loadable<DexData>>({state:"loading"});
 const active=useRef<{controller:AbortController;timer:ReturnType<typeof setTimeout>}|null>(null);
 const load=useCallback(()=>{
  if(active.current){clearTimeout(active.current.timer);active.current.controller.abort();}
  const controller=new AbortController();
  const request={controller,timer:setTimeout(()=>{
   if(active.current===request){controller.abort();setData({state:"error",message:"UNAVAILABLE"});}
  },8000)};
  active.current=request;setData({state:"loading"});
  void dexApi.snapshot(controller.signal).then(snapshot=>{
   if(active.current===request&&!controller.signal.aborted)setData({state:"ready",data:snapshot,stale:false});
  }).catch(error=>{
   if(active.current===request&&!controller.signal.aborted)setData({state:"error",message:error instanceof NativeSnapshotError?error.code:"UNAVAILABLE"});
  }).finally(()=>clearTimeout(request.timer));
 },[]);
 useEffect(()=>{
  load();
  // Reconnect is a read only action, never a replay of signing or trading.
  window.addEventListener("online",load);
  return()=>{window.removeEventListener("online",load);if(active.current){clearTimeout(active.current.timer);active.current.controller.abort();active.current=null;}};
 },[load]);
 const translated:Loadable<DexData>=data.state==="error"?{state:"error",message:data.message==="INVALID_RESPONSE"||data.message==="INVALID_ACCOUNT"?portfolioCopy[locale].invalid:portfolioCopy[locale].unavailable}:data;
 return {data:translated,retry:load};
}
