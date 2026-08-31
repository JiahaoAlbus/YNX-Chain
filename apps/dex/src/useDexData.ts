import { useCallback, useEffect, useRef, useState } from "react";
import { dexApi } from "./api";
import type { Analytics, ChainEvent, FeeSummary, Loadable, Pool, SnapshotProvenance, SpotPrice, Token, TWAP } from "./types";

type DexData={pools:Pool[];tokens:Token[];events:ChainEvent[];analytics:Analytics;provenance:SnapshotProvenance;prices:SpotPrice[];twap:TWAP[];fees:FeeSummary[]};
export function useDexData(){
 const [data,setData]=useState<Loadable<DexData>>({state:"loading"});
 const active=useRef<AbortController|null>(null);
 const load=useCallback(()=>{active.current?.abort();const controller=new AbortController();active.current=controller;setData({state:"loading"});dexApi.snapshot(controller.signal).then(snapshot=>setData({state:"ready",data:snapshot,stale:false})).catch((error)=>{if(error?.name!=="AbortError")setData({state:"error",message:error instanceof Error?error.message:"DEX consensus gateway unavailable"})});},[]);
 useEffect(()=>{
  load();
  // Network recovery is read-only: an online event only reloads the
  // authoritative snapshot and cannot resubmit a prior Wallet action.
  window.addEventListener("online",load);
  return()=>{window.removeEventListener("online",load);active.current?.abort()};
 },[load]);
 return {data,retry:load};
}
