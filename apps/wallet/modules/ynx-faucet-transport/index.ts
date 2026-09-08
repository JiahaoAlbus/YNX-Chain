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

/** No production bridge is consumed until Central freezes the endpoint/runtime lease
 * and the target platform passes its native acceptance gates. There is
 * deliberately no global-fetch fallback or caller-controlled activation argument. */
export function createProductionFaucetTransport(): NativeFaucetTransport | null {
  return null;
}

export const faucetTransportReadiness = Object.freeze({
  productionEnabled: false,
  iosNativeAcceptanceVerified: false,
  publicRuntimeVerified: false,
});
