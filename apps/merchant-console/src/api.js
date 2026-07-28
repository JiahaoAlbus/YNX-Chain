export const API_BASE = (globalThis.YNX_PAY_API_URL ?? "").replace(/\/$/, "");
export class PayAPI {
  constructor(token = "") {
    this.token = token;
  }
  async state() {
    return this.authorized("GET", "/v1/merchant/state");
  }
  async analytics() {
    return this.authorized("GET", "/v1/merchant/analytics");
  }
  async operations(query = {}) {
    const params = new URLSearchParams();
    for (const key of [
      "kind",
      "status",
      "search",
      "limit",
      "cursor",
      "from",
      "to",
    ]) {
      const value = query[key];
      if (value !== undefined && value !== null && value !== "")
        params.set(key, String(value));
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return this.authorized("GET", `/v1/merchant/operations${suffix}`);
  }
  async dataRights() {
    return this.authorized("GET", "/v1/merchant/data-rights");
  }
  async dataExport() {
    return this.authorized("GET", "/v1/merchant/data-export");
  }
  async requestDeletion(input) {
    return this.authorized(
      "POST",
      "/v1/merchant/data-deletion-requests",
      input,
    );
  }
  async cancelDeletion(id) {
    return this.authorized(
      "POST",
      `/v1/merchant/data-deletion-requests/${encodeURIComponent(id)}/cancel`,
      {},
    );
  }
  async capital() {
    return this.authorized("GET", "/v1/merchant/capital");
  }
  async providers() {
    return this.authorized("GET", "/v1/merchant/providers/catalog");
  }
  async configureProvider(input) {
    return this.authorized("PUT", "/v1/merchant/providers", input);
  }
  async testProvider(id) {
    return this.authorized(
      "POST",
      `/v1/merchant/providers/${encodeURIComponent(id)}/test`,
      {},
    );
  }
  async disableProvider(id) {
    return this.authorized(
      "POST",
      `/v1/merchant/providers/${encodeURIComponent(id)}/disable`,
      {},
    );
  }
  async catalog(input) {
    return this.authorized("POST", "/v1/merchant/catalog", input);
  }
  async invoice(input) {
    return this.authorized("POST", "/v1/merchant/invoices", input);
  }
  async recurring(input) {
    return this.authorized("POST", "/v1/merchant/recurring-drafts", input);
  }
  async webhook(endpoint) {
    return this.authorized("PUT", "/v1/merchant/webhook", { endpoint });
  }
  async rotate() {
    return this.authorized("POST", "/v1/merchant/webhook/rotate", {});
  }
  async retry(
    id,
    reason = "manual operator replay",
    idempotencyKey = `manual-${id}-${Date.now()}`,
  ) {
    return this.authorized(
      "POST",
      `/v1/merchant/webhooks/${encodeURIComponent(id)}/retry`,
      { reason, idempotencyKey },
    );
  }
  async previewBulkRetry(deliveryIds) {
    return this.authorized("POST", "/v1/merchant/webhooks/bulk-retry/preview", {
      deliveryIds,
    });
  }
  async bulkRetry(input) {
    return this.authorized("POST", "/v1/merchant/webhooks/bulk-retry", input);
  }
  async submitRefund(id, authorization, idempotencyKey) {
    return this.authorized(
      "POST",
      `/v1/merchant/refunds/${encodeURIComponent(id)}/submit`,
      { authorization, idempotencyKey },
    );
  }
  async refreshRefund(id) {
    return this.authorized(
      "POST",
      `/v1/merchant/refunds/${encodeURIComponent(id)}/refresh`,
      {},
    );
  }
  async ai(input) {
    return this.authorized("POST", "/v1/merchant/ai/runs", input);
  }
  async reviewAI(id, decision) {
    return this.authorized(
      "POST",
      `/v1/merchant/ai/runs/${encodeURIComponent(id)}/review`,
      { decision },
    );
  }
  async member(account, role) {
    return this.authorized("POST", "/v1/merchant/members", { account, role });
  }
  async export() {
    return this.authorized(
      "GET",
      "/v1/merchant/reconciliation.csv",
      undefined,
      true,
    );
  }
  async authorized(method, path, value, raw = false) {
    if (!this.token) throw new Error("Active Wallet/Gateway session required");
    return request(path, {
      method,
      body: value,
      headers: { Authorization: `Bearer ${this.token}` },
      raw,
    });
  }
}
async function request(
  path,
  { method = "GET", body, headers = {}, raw = false } = {},
) {
  if (!API_BASE)
    throw new Error("YNX Pay product service URL is not configured");
  const response = await fetch(API_BASE + path, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) {
    if (!response.ok) throw new Error(await errorText(response));
    return response.blob();
  }
  const value = await response
    .json()
    .catch(() => ({ error: "Invalid service response" }));
  if (!response.ok)
    throw new Error(
      typeof value.error === "string"
        ? value.error
        : `YNX Pay returned ${response.status}`,
    );
  return value;
}
async function errorText(response) {
  try {
    const value = await response.json();
    return value.error ?? `YNX Pay returned ${response.status}`;
  } catch {
    return `YNX Pay returned ${response.status}`;
  }
}
export function realRecords(snapshot) {
  if (!snapshot || typeof snapshot !== "object")
    throw new Error("Invalid merchant state");
  return {
    merchant: Object.values(snapshot.merchants ?? {})[0] ?? null,
    members: Object.values(snapshot.merchantMembers ?? {}),
    catalog: Object.values(snapshot.catalog ?? {}),
    invoices: Object.values(snapshot.invoices ?? {}),
    recurringDrafts: Object.values(snapshot.recurringDrafts ?? {}),
    refunds: Object.values(snapshot.refunds ?? {}),
    disputes: Object.values(snapshot.disputes ?? {}),
    deliveries: Object.values(snapshot.deliveries ?? {}),
    aiRuns: Object.values(snapshot.aiRuns ?? {}),
    providers: Object.values(snapshot.providers ?? {}),
    dataRequests: Object.values(snapshot.dataRequests ?? {}),
    bulkOperations: Object.values(snapshot.bulkOperations ?? {}),
    audit: Array.isArray(snapshot.audit) ? snapshot.audit : [],
  };
}
