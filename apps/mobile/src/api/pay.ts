const DEFAULT_APP_URL = "https://api.ynxweb4.com";
const PRODUCT = process.env.EXPO_PUBLIC_YNX_PRODUCT;
const CLIENT = PRODUCT === "social" ? "ynx-social-v1" : PRODUCT === "wallet" ? "ynx-wallet-v1" : "ynx-mobile-v1";
const REQUEST_TIMEOUT_MS = 8_000;

export type PayInvoice = Readonly<{
  id: string;
  intentId: string;
  merchant: string;
  payoutAddress: string;
  amount: number;
  currency: "YNXT";
  status: string;
  createdAt: string;
  dueAt: string;
}>;

export type PaySettlement = Readonly<{
  id: string;
  intentId: string;
  invoiceId: string;
  merchant: string;
  payoutAddress: string;
  payer: string;
  amount: number;
  currency: "YNXT";
  transactionHash: string;
  blockNumber: number;
  status: "paid";
  auditHash: string;
  createdAt: string;
}>;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchPayInvoice(reference: string, options: { baseURL?: string; fetchImpl?: FetchLike; signal?: AbortSignal } = {}): Promise<PayInvoice> {
  const id = payInvoiceID(reference);
  return parsePayInvoice(await requestJSON(`/app/pay/invoices/${encodeURIComponent(id)}`, options));
}

export async function fetchPaySettlement(invoiceID: string, options: { baseURL?: string; fetchImpl?: FetchLike; signal?: AbortSignal } = {}): Promise<PaySettlement> {
  const id = payInvoiceID(invoiceID);
  return parsePaySettlement(await requestJSON(`/app/pay/invoices/${encodeURIComponent(id)}/settlement`, options));
}

export function payInvoiceID(reference: string): string {
  const trimmed = reference.trim();
  const match = trimmed.match(/(?:^|\/)([a-zA-Z0-9][a-zA-Z0-9_-]{2,127})\/?$/);
  if (!match?.[1]) throw new Error("Enter a valid YNX Pay invoice ID or invoice link");
  return match[1];
}

export function parsePayInvoice(value: unknown): PayInvoice {
  if (!isPlainObject(value)) throw new Error("YNX Pay returned an invalid invoice");
  const currency = requiredString(value.currency, "invoice currency");
  if (currency !== "YNXT") throw new Error("This invoice is not denominated in native YNXT");
  const payoutAddress = requiredString(value.payoutAddress, "merchant payout address");
  if (!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{20,90}$/.test(payoutAddress)) throw new Error("Invoice does not contain a canonical ynx1 payout address");
  const createdAt = timestamp(value.createdAt, "invoice creation time");
  const dueAt = timestamp(value.dueAt, "invoice due time");
  return Object.freeze({
    id: requiredIdentifier(value.id, "invoice ID"),
    intentId: requiredIdentifier(value.intentId, "intent ID"),
    merchant: requiredString(value.merchant, "merchant"),
    payoutAddress,
    amount: positiveInteger(value.amount, "invoice amount"),
    currency: "YNXT",
    status: requiredString(value.status, "invoice status"),
    createdAt,
    dueAt,
  });
}

export function parsePaySettlement(value: unknown): PaySettlement {
  if (!isPlainObject(value)) throw new Error("YNX Pay returned an invalid settlement");
  const currency = requiredString(value.currency, "settlement currency");
  if (currency !== "YNXT" || value.status !== "paid") throw new Error("YNX Pay settlement is not a paid YNXT record");
  const transactionHash = requiredString(value.transactionHash, "settlement transaction hash");
  const auditHash = requiredString(value.auditHash, "settlement audit hash");
  if (!/^0x[0-9a-f]{64}$/.test(transactionHash) || !/^[0-9a-f]{64}$/.test(auditHash)) throw new Error("YNX Pay settlement proof is not canonical");
  return Object.freeze({
    id: requiredIdentifier(value.id, "settlement ID"),
    intentId: requiredIdentifier(value.intentId, "intent ID"),
    invoiceId: requiredIdentifier(value.invoiceId, "invoice ID"),
    merchant: requiredString(value.merchant, "merchant"),
    payoutAddress: requiredString(value.payoutAddress, "payout address"),
    payer: requiredString(value.payer, "payer"),
    amount: positiveInteger(value.amount, "settlement amount"),
    currency: "YNXT",
    transactionHash,
    blockNumber: positiveInteger(value.blockNumber, "settlement block number"),
    status: "paid",
    auditHash,
    createdAt: timestamp(value.createdAt, "settlement time"),
  });
}

async function requestJSON(path: string, options: { baseURL?: string; fetchImpl?: FetchLike; signal?: AbortSignal }): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort(); else options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${(options.baseURL ?? DEFAULT_APP_URL).replace(/\/$/, "")}${path}`, { method: "GET", headers: { Accept: "application/json", "X-YNX-Client": CLIENT }, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
  const text = await response.text();
  let value: unknown;
  try { value = text ? JSON.parse(text) : {}; } catch { throw new Error(`YNX Pay returned invalid JSON (${response.status})`); }
  if (!response.ok) throw new Error(isPlainObject(value) && typeof value.error === "string" ? value.error : `YNX Pay request failed (${response.status})`);
  return value;
}

function requiredIdentifier(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$/.test(result)) throw new Error(`YNX Pay ${label} is invalid`);
  return result;
}
function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`YNX Pay ${label} is missing`);
  return value;
}
function timestamp(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (Number.isNaN(new Date(result).getTime())) throw new Error(`YNX Pay ${label} is invalid`);
  return result;
}
function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(`YNX Pay ${label} must be a positive integer`);
  return value;
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
