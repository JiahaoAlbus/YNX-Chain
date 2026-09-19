export type FaucetHttpPurpose = "admit" | "rpc";
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

type ExpoFaucetModule = Readonly<NativeFaucetTransport & { productionEnabled?: unknown }>;
function installedModule(): ExpoFaucetModule | null {
  const candidate = resolveNativeModule("YnxFaucetTransport");
  if (!candidate || typeof candidate !== "object") return null;
  const module = candidate as Partial<ExpoFaucetModule>;
  if (module.productionEnabled !== true || typeof module.reserveTask !== "function" || typeof module.request !== "function" || typeof module.cancel !== "function") return null;
  return module as ExpoFaucetModule;
}

/** Production activation is compiled into the trusted native module. JavaScript
 * cannot supply an endpoint or turn a disabled platform on. */
export function createProductionFaucetTransport(): NativeFaucetTransport | null {
  const module = installedModule();
  if (!module) return null;
  return Object.freeze({
    reserveTask: (purpose: FaucetHttpPurpose) => module.reserveTask(purpose),
    request: (options: FaucetHttpRequest) => module.request(options),
    cancel: (taskId: string) => module.cancel(taskId),
  });
}

export const faucetTransportReadiness = Object.freeze({
  productionEnabled: installedModule() !== null,
  iosNativeAcceptanceVerified: false,
  publicRuntimeVerified: true,
});
import { resolveNativeModule } from "./nativeModuleResolver.js";
