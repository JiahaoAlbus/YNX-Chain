import { parseAuthorizationRequest, requestDigest, type AuthorizationRequest, type ProductBinding } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter } from "../storage/walletRepository";

export const INCOMING_AUTHORIZATION_KEY = "ynx.wallet.incoming-authorization.v1";

export type IncomingAuthorization = Readonly<{
  schemaVersion: 1;
  request: AuthorizationRequest;
  requestDigest: string;
  receivedAt: string;
}>;

/**
 * The Wallet receives deep links while the native process can be paused or
 * killed. Persisting the parsed request (never a seed, session or callback
 * secret) lets the user finish one exact approval after cold launch.
 */
export class IncomingAuthorizationStore {
  constructor(private readonly storage: SecureStorageAdapter) {}

  async capture(request: AuthorizationRequest, receivedAt = new Date()): Promise<IncomingAuthorization> {
    const record = freeze({ schemaVersion: 1 as const, request, requestDigest: requestDigest(request), receivedAt: strictTime(receivedAt, "incoming authorization time") });
    await this.storage.setItem(INCOMING_AUTHORIZATION_KEY, JSON.stringify(record));
    return record;
  }

  async restore(options: Readonly<{ now?: Date; registry: Record<string, ProductBinding> }>): Promise<IncomingAuthorization | null> {
    const serialized = await this.storage.getItem(INCOMING_AUTHORIZATION_KEY);
    if (serialized === null) return null;
    try {
      const raw = parse(serialized);
      const request = parseAuthorizationRequest(raw.request, { now: options.now, registry: options.registry });
      if (raw.requestDigest !== requestDigest(request)) throw new Error("Incoming Wallet authorization digest is invalid");
      return freeze({ schemaVersion: 1 as const, request, requestDigest: raw.requestDigest, receivedAt: raw.receivedAt });
    } catch (error) {
      await this.clear();
      throw error;
    }
  }

  async clear(): Promise<void> { await this.storage.deleteItem(INCOMING_AUTHORIZATION_KEY); }
}

function parse(serialized: string): { schemaVersion: 1; request: unknown; requestDigest: string; receivedAt: string } {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error("Incoming Wallet authorization is unreadable"); }
  if (!plain(value) || Object.keys(value).sort().join(",") !== "receivedAt,request,requestDigest,schemaVersion" || value.schemaVersion !== 1 || typeof value.requestDigest !== "string" || !/^[0-9a-f]{64}$/.test(value.requestDigest)) throw new Error("Incoming Wallet authorization is invalid");
  strictTime(value.receivedAt, "incoming authorization time");
  return value as { schemaVersion: 1; request: unknown; requestDigest: string; receivedAt: string };
}
function strictTime(value: Date | unknown, label: string): string { const result = value instanceof Date ? value.toISOString() : value; if (typeof result !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) || new Date(result).toISOString() !== result) throw new Error(`${label} is invalid`); return result; }
function freeze(value: IncomingAuthorization): IncomingAuthorization { return Object.freeze({ ...value, request: Object.freeze({ ...value.request, scopes: Object.freeze([...value.request.scopes]) }) }); }
function plain(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
