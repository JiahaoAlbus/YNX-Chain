// Original Native walletPayInvoice.ts reference/parser/read-only transport,
// without Native settlement/outbox operations. This is a legacy service
// projection, not a trusted signed invoice. Never used for signing or payment.
import { evmAddressFromYNX, ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import {WalletPayError,walletPayInvoiceID} from "./wallet-pay-invoice-reference-id.mjs";
import {verifySignedPayInvoice,SignedPayInvoiceError} from "./wallet-pay-signed-invoice.mjs";
export {WalletPayError,walletPayInvoiceID};
function fail(code) { throw new WalletPayError(code); }
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function text(v, max = 128) {
    if (typeof v !== "string" || !v || v.trim() !== v || v.length > max || /[\x00-\x1f\x7f]/.test(v))
        fail("PAY_INVALID_RESPONSE");
    return v;
}
function identifier(v) { const s = text(v); if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(s))
    fail("PAY_INVALID_IDENTIFIER"); return s; }
function whole(v) { if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0)
    fail("PAY_WHOLE_YNXT_REQUIRED"); return v; }
function time(v) {
    const s = text(v, 40), parsed = Date.parse(s);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(s) || !Number.isFinite(parsed) ||
        new Date(parsed).toISOString().slice(0, 19) !== s.slice(0, 19))
        fail("PAY_INVALID_TIME");
    return s;
}
function address(v) { try {
    const value = text(v);
    if (ynxAddressFromEVM(evmAddressFromYNX(value)) !== value)
        fail("PAY_INVALID_RECIPIENT");
    return value;
}
catch {
    return fail("PAY_INVALID_RECIPIENT");
} }
/** Extract only a reference; never navigate/fetch a QR-provided origin. Existing
 * identifiers and the old Pay deep link remain compatible; no amount/token,
 * callback, URL credentials, encoded path or action may ride along. */
export function parseWalletPayInvoice(value, expectedID) {
    if (!object(value) || value.currency !== "YNXT" || !["issued", "paid", "expired", "cancelled"].includes(String(value.status)))
        fail("PAY_INVALID_INVOICE");
    const id = identifier(value.id);
    if (id !== walletPayInvoiceID(expectedID))
        fail("PAY_INVOICE_ID_MISMATCH");
    const result = { id, intentId: identifier(value.intentId), merchant: text(value.merchant), payoutAddress: address(value.payoutAddress), amount: whole(value.amount), currency: "YNXT",
        status: value.status, createdAt: time(value.createdAt), dueAt: time(value.dueAt) };
    if (!Number.isSafeInteger(result.amount + 1) || Date.parse(result.dueAt) <= Date.parse(result.createdAt))
        fail("PAY_INVALID_INVOICE");
    return Object.freeze(result);
}
const MAX_PAY_RESPONSE_BYTES = 32768;
async function boundedPayText(response, signal) {
  const declared = response.headers?.get("content-length");
  if (declared != null) {
    if (!/^\d+$/.test(declared)) fail("PAY_INVALID_RESPONSE");
    if (Number(declared) > MAX_PAY_RESPONSE_BYTES) fail("PAY_RESPONSE_TOO_LARGE");
  }
  // React Native transports without a streaming body retain the finite timeout.
  // Validate UTF-8 bytes without allocating a second potentially large buffer.
  if (typeof response.body?.getReader !== "function") {
    const raw = await response.text();
    if (raw.length > MAX_PAY_RESPONSE_BYTES) fail("PAY_RESPONSE_TOO_LARGE");
    let bytes = 0;
    for (const character of raw) {
      const point = character.codePointAt(0);
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (bytes > MAX_PAY_RESPONSE_BYTES) fail("PAY_RESPONSE_TOO_LARGE");
    }
    return raw;
  }
  const reader = response.body.getReader(), bytes = new Uint8Array(MAX_PAY_RESPONSE_BYTES);
  let length = 0;
  const cancel = () => {
    try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    try { reader.releaseLock(); } catch {}
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) fail("PAY_READ_CANCELLED");
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) fail("PAY_READ_CANCELLED");
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) fail("PAY_INVALID_RESPONSE");
      if (chunk.value.byteLength > MAX_PAY_RESPONSE_BYTES - length) fail("PAY_RESPONSE_TOO_LARGE");
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)); }
    catch { return fail("PAY_INVALID_RESPONSE"); }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}
export class WalletPayInvoiceClient {
    fetcher;
    timeoutMs;
    origin;
    constructor(origin = "https://api.ynxweb4.com", fetcher = fetch, timeoutMs = 8000) {
        this.fetcher = fetcher;
        this.timeoutMs = timeoutMs;
        let url;
        try {
            url = new URL(origin);
        }
        catch {
            fail("PAY_INVALID_API_ORIGIN");
        }
        if (url.origin !== origin || url.protocol !== "https:" || url.username || url.password)
            fail("PAY_INVALID_API_ORIGIN");
        this.origin = origin;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 8000)
            fail("PAY_INVALID_READ_TIMEOUT");
    }
    async invoice(reference, assertCurrent, signal) {
        const id = walletPayInvoiceID(reference);
        assertCurrent();
        const value = await this.read(`/app/pay/invoices/${id}`, signal);
        assertCurrent();
        return parseWalletPayInvoice(value, id);
    }
    /** Original signed wire, separate from legacy projection. Protected issuer
     * policy is mandatory; HTTP/QR keys cannot supply their own trust. */
    async signedInvoice(reference, policy, assertCurrent, signal, now = Date.now) {
        assertCurrent();
        if (!policy || typeof policy.resolve !== "function")
            throw new SignedPayInvoiceError("PAY_SIGNED_TRUST_POLICY_REQUIRED");
        const id = walletPayInvoiceID(reference);
        if (!/^inv_[a-f0-9]{20}$/.test(id))
            throw new SignedPayInvoiceError("PAY_SIGNED_INVALID_INVOICE");
        const value = await this.read(`/app/pay-product/v1/invoices/${id}`, signal);
        assertCurrent();
        return verifySignedPayInvoice(value, id, policy, assertCurrent, now());
    }
    async read(route, signal) {
        const controller = new AbortController();
        let rejectStopped;
        const stopped = new Promise((_, reject) => { rejectStopped = reject; });
        const stop = (code) => { rejectStopped(new WalletPayError(code)); controller.abort(); };
        const abort = () => stop("PAY_READ_CANCELLED");
        signal?.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(() => stop("PAY_READ_TIMEOUT"), this.timeoutMs);
        try {
            if (signal?.aborted)
                fail("PAY_READ_CANCELLED");
            return await Promise.race([(async () => {
                    const url = this.origin + route;
                    const response = await this.fetcher(url, { method: "GET", redirect: "error", credentials: "omit", signal: controller.signal, headers: { Accept: "application/json", "X-YNX-Client": "ynx-wallet-v1" } });
                    if (response.redirected || response.url && response.url !== url)
                        fail("PAY_READ_ORIGIN_MISMATCH");
                    if (!response.ok)
                        fail(response.status === 401 || response.status === 403 ? "PAY_SESSION_REQUIRED" : "PAY_READ_UNAVAILABLE");
                    const raw = await boundedPayText(response, controller.signal);
                    try {
                        return JSON.parse(raw);
                    }
                    catch {
                        return fail("PAY_INVALID_RESPONSE");
                    }
                })(), stopped]);
        }
        catch (error) {
            if (error instanceof WalletPayError)
                throw error;
            return fail("PAY_READ_UNAVAILABLE");
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            controller.abort();
        }
    }
}
