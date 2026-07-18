import type { Analytics, ChainEvent, Pool, Position } from "./types";
const BASE = (import.meta.env.VITE_DEX_API_URL || "").replace(/\/$/, "");

async function request<T>(path:string, signal?:AbortSignal, headers:Record<string,string>={}):Promise<T> {
  const response = await fetch(`${BASE}${path}`, { signal, headers:{Accept:"application/json", ...headers}, credentials:"omit" });
  if (!response.ok) throw new Error(response.status === 403 ? "Wallet session rejected or central service unavailable." : `DEX service returned ${response.status}.`);
  return response.json() as Promise<T>;
}
export const dexApi = {
  pools:(signal?:AbortSignal)=>request<{items:Pool[];source:string}>("/v1/pools",signal),
  events:(signal?:AbortSignal)=>request<{items:ChainEvent[];source:string}>("/v1/transactions?limit=50",signal),
  analytics:(signal?:AbortSignal)=>request<Analytics>("/v1/analytics",signal),
  positions:(account:string,sessionBinding:string,signal?:AbortSignal)=>request<{items:Position[]}>("/v1/account/positions",signal,{"X-YNX-Account":account,"X-YNX-Session-Binding":sessionBinding}),
};
