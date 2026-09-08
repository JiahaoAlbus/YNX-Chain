import { utf8ToBytes } from "@noble/hashes/utils.js";
import { createProductionFaucetTransport, type NativeFaucetTransport, type FaucetHttpRequest, type FaucetHttpResponse } from "../../modules/ynx-faucet-transport";
import type { FaucetAdmissionTransport } from "./faucetAdmission";
import type { FaucetClaimRPC, FaucetReadMethod } from "./faucetClaim";

export const NATIVE_FAUCET_AUTHORITY = "https://faucet.ynxweb4.com";
export const NATIVE_FAUCET_CHAIN_ORIGIN = "https://rpc.ynxweb4.com";
const endpoint = { admit: NATIVE_FAUCET_AUTHORITY + "/request", rpc: NATIVE_FAUCET_CHAIN_ORIGIN + "/evm" } as const;
const METHODS = new Set<FaucetReadMethod>(["eth_chainId", "ynx_getFaucetModel", "ynx_getDurabilityModel", "ynx_getTransactionDurability", "eth_getTransactionReceipt"]);
export class FaucetNativeSessionError extends Error {
  constructor(readonly code: "FAUCET_HOST_INVALID" | "FAUCET_HOST_CANCELLED" | "FAUCET_HOST_TIMEOUT" | "FAUCET_HOST_UNAVAILABLE" | "FAUCET_HOST_RPC_ERROR") { super(code); }
}
function fail(code: FaucetNativeSessionError["code"]): never { throw new FaucetNativeSessionError(code); }

/** Internal trusted host adapter, scoped to one operation's AbortSignal. It
 * exposes fixed-purpose methods, never caller-supplied URLs or fetch. Cancelling
 * may discard a late native response; the admission controller's original
 * unknown request remains authoritative and is retried only by explicit intent.
 */
export class FaucetNativeSession {
  readonly rpc: FaucetClaimRPC;
  readonly transport: FaucetAdmissionTransport;
  constructor(private readonly host: NativeFaucetTransport, private readonly signal: AbortSignal) {
    this.rpc = Object.freeze({ origin: NATIVE_FAUCET_CHAIN_ORIGIN, request: (method: FaucetReadMethod, params: readonly string[]) => this.read(method, params) });
    this.transport = async input => {
      if (input.url !== endpoint.admit || input.method !== "POST" || typeof input.body !== "string" || utf8ToBytes(input.body).length > 1024 ||
          typeof input.requestId !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(input.requestId)) fail("FAUCET_HOST_INVALID");
      let body: any; try { body = JSON.parse(input.body); } catch { fail("FAUCET_HOST_INVALID"); }
      if (!body || Array.isArray(body) || Object.keys(body).join(",") !== "requestId,address,amount" || JSON.stringify(body) !== input.body ||
          body.requestId !== input.requestId || typeof body.address !== "string" || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(body.address) ||
          !Number.isSafeInteger(body.amount) || body.amount < 1) fail("FAUCET_HOST_INVALID");
      return this.exchange("admit", taskId => ({ purpose: "admit", taskId, requestId: input.requestId, body: input.body }));
    };
  }
  private async read(method: FaucetReadMethod, params: readonly string[]): Promise<unknown> {
    if (!METHODS.has(method) || !Array.isArray(params) || (method === "ynx_getTransactionDurability" || method === "eth_getTransactionReceipt" ?
      params.length !== 1 || typeof params[0] !== "string" || !/^0x[0-9a-f]{64}$/.test(params[0]) : params.length !== 0)) fail("FAUCET_HOST_INVALID");
    const boundParams = Object.freeze([...params]); let rpcId = "";
    const response = await this.exchange("rpc", taskId => { rpcId = taskId; return { purpose: "rpc", taskId, rpcId, method, params: boundParams }; });
    if (this.signal.aborted) fail("FAUCET_HOST_CANCELLED");
    if (response.status !== 200) fail("FAUCET_HOST_UNAVAILABLE");
    let body: any; try { body = uniqueJSON(response.body); } catch { fail("FAUCET_HOST_INVALID"); }
    if (!body || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || body.id !== rpcId) fail("FAUCET_HOST_INVALID");
    const keys = Object.keys(body).sort().join(",");
    if (keys === "error,id,jsonrpc") {
      if (!body.error || Array.isArray(body.error) || !Number.isSafeInteger(body.error.code) || typeof body.error.message !== "string") fail("FAUCET_HOST_INVALID");
      fail("FAUCET_HOST_RPC_ERROR");
    }
    if (keys !== "id,jsonrpc,result") fail("FAUCET_HOST_INVALID");
    return body.result;
  }
  private exchange(purpose: "admit" | "rpc", input: (taskId: string) => FaucetHttpRequest): Promise<FaucetHttpResponse> {
    if (this.signal.aborted) return Promise.reject(new FaucetNativeSessionError("FAUCET_HOST_CANCELLED"));
    let taskId: string;
    try { taskId = this.host.reserveTask(purpose); } catch { return Promise.reject(new FaucetNativeSessionError("FAUCET_HOST_UNAVAILABLE")); }
    if (typeof taskId !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(taskId)) {
      // No attempt to cancel an untrusted/non-string identifier through the bridge.
      return Promise.reject(new FaucetNativeSessionError("FAUCET_HOST_INVALID"));
    }
    return new Promise((resolve, reject) => {
      let terminal = false;
      const cancelNative = () => { try { this.host.cancel(taskId); } catch { /* Native monotonic deadline remains required. */ } };
      const finish = (error: FaucetNativeSessionError | null, response?: FaucetHttpResponse) => {
        if (terminal) return;
        terminal = true; clearTimeout(timer); this.signal.removeEventListener("abort", aborted); cancelNative();
        if (error) reject(error); else resolve(response!);
      };
      const aborted = () => finish(new FaucetNativeSessionError("FAUCET_HOST_CANCELLED"));
      // Native owns the 15s monotonic deadline. This JS watchdog only prevents a
      // hung bridge from retaining UI promises; it is not wire cancellation proof.
      const timer = setTimeout(() => finish(new FaucetNativeSessionError("FAUCET_HOST_TIMEOUT")), 20000);
      this.signal.addEventListener("abort", aborted, { once: true });
      if (this.signal.aborted) { aborted(); return; }
      let pending: Promise<FaucetHttpResponse>;
      try { pending = this.host.request(input(taskId)); }
      catch { finish(new FaucetNativeSessionError("FAUCET_HOST_UNAVAILABLE")); return; }
      Promise.resolve(pending).then(response => {
        if (terminal) return;
        if (this.signal.aborted) { aborted(); return; }
        try {
          const keys = response && typeof response === "object" && !Array.isArray(response) ? Object.keys(response).sort().join(",") : "";
          if (keys !== "body,cacheControl,contentType,redirected,status,url" || response.url !== endpoint[purpose] || response.redirected !== false ||
              !Number.isInteger(response.status) || response.status < 100 || response.status > 599 || response.status >= 300 && response.status < 400 ||
              typeof response.contentType !== "string" || response.contentType.length > 256 || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.contentType) ||
              typeof response.cacheControl !== "string" || response.cacheControl.length > 256 ||
              (purpose === "admit" && response.cacheControl !== "no-store") || typeof response.body !== "string" ||
              response.body.length > 16384 || utf8ToBytes(response.body).length > 16384) fail("FAUCET_HOST_INVALID");
          uniqueJSON(response.body);
          finish(null, Object.freeze({ ...response }));
        } catch { finish(new FaucetNativeSessionError("FAUCET_HOST_INVALID")); }
      }, () => finish(new FaucetNativeSessionError("FAUCET_HOST_UNAVAILABLE")));
    });
  }
}

/** Both the native module and this factory remain disabled until separately
 * source-bound activation. No boolean argument can turn this on. */
export function createProductionFaucetSession(signal: AbortSignal): FaucetNativeSession | null {
  const host = createProductionFaucetTransport(); return host ? new FaucetNativeSession(host, signal) : null;
}

/** JSON.parse supplies grammar validation; this bounded second pass rejects
 * duplicate decoded object keys without requiring Go's whitespace/key order to
 * match JS serialization. It never constructs objects from untrusted keys. */
function uniqueJSON(text: string): unknown {
  const parsed = JSON.parse(text);
  let offset = 0, nodes = 0;
  const whitespace = () => { while (/\s/.test(text[offset] ?? "x")) offset++; };
  const string = (): string => {
    const start = offset++;
    while (text[offset] !== '"') { if (text[offset] === "\\") offset++; offset++; }
    offset++; return JSON.parse(text.slice(start, offset));
  };
  const value = (depth: number): void => {
    if (depth > 32 || ++nodes > 2048) fail("FAUCET_HOST_INVALID");
    whitespace(); const token = text[offset];
    if (token === '"') { string(); return; }
    if (token === "{") {
      offset++; whitespace(); const keys = new Set<string>();
      if (text[offset] === "}") { offset++; return; }
      while (true) {
        whitespace(); const key = string(); if (keys.has(key)) fail("FAUCET_HOST_INVALID"); keys.add(key);
        whitespace(); offset++; value(depth + 1); whitespace();
        if (text[offset++] === "}") return;
      }
    }
    if (token === "[") {
      offset++; whitespace(); if (text[offset] === "]") { offset++; return; }
      while (true) { value(depth + 1); whitespace(); if (text[offset++] === "]") return; }
    }
    const start = offset;
    while (offset < text.length && !/[\s,}\]]/.test(text[offset]!)) offset++;
    if (/[-0-9]/.test(token ?? "x") && !Number.isFinite(Number(text.slice(start, offset)))) fail("FAUCET_HOST_INVALID");
  };
  value(0); return parsed;
}
