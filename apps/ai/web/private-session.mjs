import {
  createBrowserProductSessionClient,
  ProductSessionGatewayFetchAdapter,
} from './vendor/product-session-browser.mjs';

const AUTHORITY = 'https://wallet-auth.ynxweb4.com';
const ORIGIN = 'https://assistant.ynxweb4.com';
const PROOF_HEADER = 'X-YNX-Product-Session-Proof-V2';
const SCOPES = Object.freeze([
  'ai:actions', 'ai:attachments', 'ai:conversations',
  'ai:data-control', 'ai:generate', 'ai:permissions',
]);

// Construction does not connect, open Wallet, or sign an API proof.
// Installation and scheme availability must come from the real handoff owner.
export async function createAIPrivateSession({
  environment = globalThis,
  walletInstalled = () => false,
  schemeRegistered = () => false,
} = {}) {
  if (environment.location.origin !== ORIGIN) {
    throw new Error('AI private sessions require the registered HTTPS origin');
  }
  const fetcher = environment.fetch.bind(environment);
  const configResponse = await fetcher('/api/wallet/config', {
    cache: 'no-store', credentials: 'omit', redirect: 'error',
  });
  if (!configResponse.ok) throw new Error('AI Wallet configuration is unavailable');
  const config = await configResponse.json();
  if (!config.canonicalConfigured || config.gatewayOrigin !== AUTHORITY ||
      config.productId !== 'ai' || config.clientId !== 'ynx-ai-v1' ||
      config.applicationId !== 'com.ynxweb4.ai.web' ||
      config.origin !== ORIGIN || config.callback !== `${ORIGIN}/wallet-auth/callback` ||
      config.localFixtureAuthEnabled || config.proofHeader !== PROOF_HEADER) {
    throw new Error('AI canonical Wallet configuration is not ready');
  }
  const registryResponse = await fetcher('/vendor/product-session-registry.json', {
    cache: 'no-store', credentials: 'omit', redirect: 'error',
  });
  if (!registryResponse.ok) throw new Error('AI Wallet registry is unavailable');
  const registry = await registryResponse.json();
  const gateway = new ProductSessionGatewayFetchAdapter({
    endpoint: AUTHORITY, fetch: fetcher, walletInstalled, schemeRegistered,
    timeoutMs: 10000,
  });
  const adapter = await createBrowserProductSessionClient({
    registry, productId: 'ai', scopes: [...SCOPES],
    purpose: 'Sign in to YNX AI to access your private conversations and AI tools.',
    gateway, environment,
  });
  return new AIPrivateSession(adapter, fetcher);
}

export class AIPrivateSession {
  #adapter;
  #fetch;
  #epoch = 0;
  #closed = false;
  #transition = false;
  #requests = new Set();

  constructor(adapter, fetcher) {
    this.#adapter = adapter;
    this.#fetch = fetcher;
  }

  get current() { return this.#adapter.client.current; }

  #invalidate() {
    this.#epoch += 1;
    for (const controller of this.#requests) controller.abort();
    this.#requests.clear();
  }

  async #lifecycle(operation) {
    if (this.#closed) throw new Error('AI private session is closed');
    if (this.#transition) throw new Error('AI private session transition is in progress');
    this.#transition = true;
    this.#invalidate();
    const epoch = this.#epoch;
    try {
      const result = await operation();
      if (epoch !== this.#epoch || this.#closed) {
        throw new DOMException('AI session changed', 'AbortError');
      }
      return result;
    } finally {
      this.#transition = false;
    }
  }

  // A connecting return is not permission to automatically open Wallet.
  restore() { return this.#lifecycle(() => this.#adapter.client.restore()); }
  begin() { return this.#lifecycle(() => this.#adapter.client.beginDetected()); }
  handleReturn(url) {
    return this.#lifecycle(() => this.#adapter.client.handleReturn(url));
  }
  // SDK retains durable revocation intent on failure. Never clear its storage.
  disconnect() { return this.#lifecycle(() => this.#adapter.client.disconnect()); }

  // consume runs inside the epoch guard, including JSON or streaming reads.
  // The server independently chooses its required scope for the business route.
  async request(path, scope, init = {}, consume = response => response.json()) {
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/') ||
        url.username || url.password || url.hash || !SCOPES.includes(scope)) {
      throw new Error('Invalid AI private API request');
    }
    if (this.#closed || this.#transition || this.current.status !== 'connected') {
      throw new Error('A connected AI private session is required');
    }
    const epoch = this.#epoch;
    const binding = this.current.session.sessionBinding;
    const guard = () => {
      if (this.#closed || this.#transition || epoch !== this.#epoch ||
          this.current.status !== 'connected' ||
          this.current.session.sessionBinding !== binding) {
        throw new DOMException('AI session changed', 'AbortError');
      }
    };
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init.signal?.aborted) abort();
    init.signal?.addEventListener('abort', abort, { once: true });
    this.#requests.add(controller);
    try {
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
      const authorization = await this.#adapter.createIntrospectionProof([scope]);
      guard();
      const headers = new Headers(init.headers);
      headers.delete('Authorization');
      headers.delete('X-YNX-Product-Session-Proof');
      headers.delete('X-YNX-Device-ID');
      headers.set(PROOF_HEADER, authorization.proofHeader);
      const response = await this.#fetch(url.href, {
        ...init, headers, signal: controller.signal,
        credentials: 'omit', cache: 'no-store', redirect: 'error',
      });
      guard();
      // No automatic retry: every attempt needs a fresh proof; business writes
      // additionally need their own idempotency and confirmation semantics.
      const result = await consume(response, guard);
      guard();
      return result;
    } finally {
      init.signal?.removeEventListener('abort', abort);
      this.#requests.delete(controller);
    }
  }

  close() {
    this.#closed = true;
    this.#invalidate();
    this.#adapter.close();
  }
}
