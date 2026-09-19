export type FaucetHttpPurpose = "admit" | "rpc";
export type FaucetEndpointRoute = "primary" | "legacy";
export type FaucetReadMethod = "eth_chainId" | "ynx_getFaucetModel" | "ynx_getDurabilityModel" |
  "ynx_getTransactionDurability" | "eth_getTransactionReceipt";
export type FaucetHttpRequest = Readonly<
  { purpose: "admit"; taskId: string; requestId: string; body: string } |
  { purpose: "rpc"; taskId: string; rpcId: string; method: FaucetReadMethod; params: readonly string[] }
>;
export type FaucetHttpResponse = Readonly<{
  url: string; redirected: false; status: number; contentType: string; cacheControl: string; body: string;
}>;
export interface NativeFaucetTransport {
  reserveTask(purpose: FaucetHttpPurpose): string;
  request(options: FaucetHttpRequest): Promise<FaucetHttpResponse>;
  /** A cancellation acknowledgement never proves an earlier dispatch was not processed. */
  cancel(taskId: string): void;
}

type NativeFaucetModule = Readonly<{
  reserveTask(route: FaucetEndpointRoute, purpose: FaucetHttpPurpose): string;
  request(options: FaucetHttpRequest & Readonly<{ route: FaucetEndpointRoute }>): Promise<FaucetHttpResponse>;
  cancel(route: FaucetEndpointRoute, taskId: string): void;
}>;

let resolvedModule: NativeFaucetModule | undefined;
function productionModule(): NativeFaucetModule | null {
  if (resolvedModule) return resolvedModule;
  const candidate = (globalThis as typeof globalThis & { expo?: { modules?: Record<string, unknown> } }).expo?.modules?.YnxFaucetTransport;
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Partial<NativeFaucetModule>;
  if (typeof value.reserveTask !== "function" || typeof value.request !== "function" || typeof value.cancel !== "function") return null;
  resolvedModule = value as NativeFaucetModule;
  return resolvedModule;
}

/** The endpoint route is a fixed native enum, never a caller-provided URL.
 * The legacy route exists only so an already persisted legacy request can be
 * inspected or explicitly retried with its original ID. There is no Fetch
 * fallback and no automatic route change after an unknown result. */
export function createProductionFaucetTransport(route: FaucetEndpointRoute = "primary"): NativeFaucetTransport | null {
  if (route !== "primary" && route !== "legacy") return null;
  const native = productionModule();
  if (!native) return null;
  return Object.freeze({
    reserveTask: (purpose: FaucetHttpPurpose) => native.reserveTask(route, purpose),
    request: (options: FaucetHttpRequest) => native.request(Object.freeze({ ...options, route })),
    cancel: (taskId: string) => native.cancel(route, taskId),
  });
}

export const faucetTransportReadiness = Object.freeze({
  productionEnabled: true,
  iosNativeAcceptanceVerified: false,
  publicRuntimeVerified: false,
});
