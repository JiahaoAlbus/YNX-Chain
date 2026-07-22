const loopback = (value) => {
  const url = new URL(value);
  return url.username === "" && url.password === "" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]");
};

export class QuantClient {
  constructor({baseUrl = "http://127.0.0.1:6444", fetchImpl = globalThis.fetch} = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
  }
  health() { return this.#request("GET", "/health"); }
  snapshot() { return this.#request("GET", "/v1/snapshot"); }
  killSwitch({reason, approved = false}) {
    if (!approved) throw new Error("explicit operator approval required");
    return this.#mutation("/v1/risk/kill", {reason});
  }
  revokeMandate({digest, actor, approved = false}) {
    if (!approved) throw new Error("explicit operator approval required");
    if (!/^[a-f0-9]{64}$/i.test(digest)) throw new TypeError("SHA-256 mandate digest required");
    return this.#mutation(`/v1/testnet/mandates/${digest}/revoke`, {actor});
  }
  #mutation(path, body) {
    if (!loopback(this.baseUrl)) throw new Error("preview mutations require a loopback endpoint");
    return this.#request("POST", path, body);
  }
  async #request(method, path, body) {
    const response = await this.fetch(this.baseUrl + path, {
      method,
      headers: body ? {"content-type": "application/json", "x-ynx-preview-mode": "local-paper"} : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
    return value;
  }
}
