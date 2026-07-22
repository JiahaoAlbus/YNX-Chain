const RETRYABLE = new Set([429, 503]);
const IDEMPOTENT = new Set(["GET", "HEAD", "PUT", "DELETE"]);

export class YNXCloudError extends Error {
  constructor(message, { status = 0, requestId = "", errorId = "", retryAfter = 0, cause } = {}) {
    super(message, { cause });
    this.name = "YNXCloudError";
    this.status = status;
    this.requestId = requestId;
    this.errorId = errorId;
    this.retryAfter = retryAfter;
  }
}

function endpointURL(endpoint, path) {
  const base = endpoint.replace(/\/+$/, "");
  const prefix = base.endsWith("/api/v1") ? base : `${base}/api/v1`;
  return `${prefix}${path.startsWith("/") ? path : `/${path}`}`;
}

function safeSegment(value) {
  if (!value || typeof value !== "string") throw new TypeError("a non-empty identifier is required");
  return encodeURIComponent(value);
}

function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class YNXCloudClient {
  constructor({ endpoint, product, getAccessToken, fetch: fetchImpl = globalThis.fetch, maxRetries = 2 }) {
    if (!/^https?:\/\//.test(endpoint || "")) throw new TypeError("endpoint must be an absolute HTTP(S) URL");
    if (product !== "cloud" && product !== "docs") throw new TypeError("product must be cloud or docs");
    if (typeof getAccessToken !== "function") throw new TypeError("getAccessToken must be a function");
    if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
    this.endpoint = endpoint;
    this.product = product;
    this.getAccessToken = getAccessToken;
    this.fetch = fetchImpl;
    this.maxRetries = Math.max(0, Math.min(5, Number(maxRetries) || 0));
  }

  async request(path, { method = "GET", body, headers = {}, signal, response = "json", retry } = {}) {
    method = method.toUpperCase();
    const attempts = retry ?? (IDEMPOTENT.has(method) ? this.maxRetries + 1 : 1);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const token = await this.getAccessToken();
      if (!token || typeof token !== "string") throw new YNXCloudError("Wallet product session is unavailable");
      const requestHeaders = new Headers(headers);
      requestHeaders.set("Authorization", `Bearer ${token}`);
      requestHeaders.set("Accept", response === "json" ? "application/json" : "application/octet-stream");
      let payload = body;
      if (body !== undefined && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body) && typeof body !== "string" && !(body instanceof Blob)) {
        requestHeaders.set("Content-Type", "application/json");
        payload = JSON.stringify(body);
      }
      let result;
      try {
        result = await this.fetch(endpointURL(this.endpoint, path), { method, headers: requestHeaders, body: payload, signal });
      } catch (cause) {
        throw new YNXCloudError("YNX Cloud request failed before a response was received", { cause });
      }
      const requestId = result.headers.get("x-request-id") || "";
      const errorId = result.headers.get("x-error-id") || "";
      const retryAfter = parseRetryAfter(result.headers.get("retry-after"));
      if (!result.ok) {
        let message = `YNX Cloud returned HTTP ${result.status}`;
        try {
          const error = await result.json();
          if (typeof error?.error === "string" && error.error) message = error.error;
        } catch {}
        if (RETRYABLE.has(result.status) && attempt + 1 < attempts) {
          await delay(Math.min(5000, retryAfter || 100 * 2 ** attempt));
          continue;
        }
        throw new YNXCloudError(message, { status: result.status, requestId, errorId, retryAfter });
      }
      if (response === "response") return result;
      if (response === "bytes") return new Uint8Array(await result.arrayBuffer());
      if (response === "text") return result.text();
      if (result.status === 204) return null;
      return result.json();
    }
    throw new YNXCloudError("YNX Cloud retry budget was exhausted");
  }

  list(options = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) if (value !== undefined && value !== "") query.set(key, String(value));
    return this.request(`/objects?${query}`);
  }
  getObject(id) { return this.request(`/objects/${safeSegment(id)}`); }
  createObject(input) { return this.request("/objects", { method: "POST", body: input }); }
  deleteObject(id) { return this.request(`/objects/${safeSegment(id)}`, { method: "DELETE" }); }
  content(id, { range, signal } = {}) { return this.request(`/objects/${safeSegment(id)}/content`, { headers: range ? { Range: range } : {}, response: "response", signal }); }
  versions(id) { return this.request(`/objects/${safeSegment(id)}/versions`); }
  restoreVersion(id, version) { return this.request(`/objects/${safeSegment(id)}/versions/${safeSegment(String(version))}/restore`, { method: "POST" }); }
  saveDocument(id, input) { return this.request(`/objects/${safeSegment(id)}/document`, { method: "PUT", body: input, retry: 1 }); }
  star(id, starred) { return this.request(`/objects/${safeSegment(id)}/star`, { method: "POST", body: { starred } }); }
  trash(id) { return this.request(`/objects/${safeSegment(id)}/trash`, { method: "POST" }); }
  restore(id) { return this.request(`/objects/${safeSegment(id)}/restore`, { method: "POST" }); }
  quota() { return this.request("/quota"); }
  usage() { return this.request("/usage"); }
  audit() { return this.request("/audit"); }
  exportData() { return this.request("/export", { response: "response" }); }
  deletionRecords() { return this.request("/deletions"); }
  retryDeletion(id) { return this.request(`/deletions/${safeSegment(id)}/retry`, { method: "POST" }); }

  initiateMultipart(input) { return this.request("/multipart", { method: "POST", body: input }); }
  multipartStatus(id) { return this.request(`/multipart/${safeSegment(id)}`); }
  putMultipartPart(id, part, bytes, sha256) {
    return this.request(`/multipart/${safeSegment(id)}/parts/${safeSegment(String(part))}`, { method: "PUT", body: bytes, headers: { "Content-Type": "application/octet-stream", "X-Content-SHA256": sha256 } });
  }
  completeMultipart(id, parts) { return this.request(`/multipart/${safeSegment(id)}/complete`, { method: "POST", body: { parts } }); }
  cancelMultipart(id) { return this.request(`/multipart/${safeSegment(id)}`, { method: "DELETE" }); }

  initiateDirectUpload(input) { return this.request("/direct-uploads", { method: "POST", body: input }); }
  directUploadStatus(id) { return this.request(`/direct-uploads/${safeSegment(id)}`); }
  completeDirectUpload(id) { return this.request(`/direct-uploads/${safeSegment(id)}/complete`, { method: "POST" }); }
  cancelDirectUpload(id) { return this.request(`/direct-uploads/${safeSegment(id)}`, { method: "DELETE" }); }

  createAIJob(input) { return this.request("/ai/jobs", { method: "POST", body: input }); }
  getAIJob(id) { return this.request(`/ai/jobs/${safeSegment(id)}`); }
  cancelAIJob(id) { return this.request(`/ai/jobs/${safeSegment(id)}/cancel`, { method: "POST" }); }
  reviewAIJob(id, decision) { return this.request(`/ai/jobs/${safeSegment(id)}/review`, { method: "POST", body: { decision } }); }
}
