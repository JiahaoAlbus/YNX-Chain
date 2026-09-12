const proofHeaderName = 'X-YNX-Product-Session-Proof-V2';
const forbiddenHeaders = ['authorization', 'x-ynx-product-session-proof', proofHeaderName.toLowerCase()];
const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// The caller supplies the actual SDK browser adapter after registry-bound setup.
// No private authority URL or synthetic Wallet identity is accepted here.
export function createDocsSessionTransport({adapter, origin, fetchImpl = globalThis.fetch}) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.origin !== origin) throw new TypeError('Docs requires an exact HTTPS origin');
  if (typeof adapter?.createIntrospectionProof !== 'function') throw new TypeError('Docs requires the Wallet SDK session adapter');
  if (typeof fetchImpl !== 'function') throw new TypeError('Docs requires a fetch implementation');

  return async function request(path, {scopes, idempotencyKey, signal, ...options} = {}) {
    if (typeof path !== 'string' || !path.startsWith('/api/v1/')) throw new TypeError('Docs API path required');
    const url = new URL(path, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/api/v1/') || url.hash) throw new TypeError('Docs API path required');
    if (!Array.isArray(scopes) || !scopes.length || scopes.some((scope) => typeof scope !== 'string' || !scope.trim()) || new Set(scopes).size !== scopes.length) {
      throw new TypeError('Explicit route scopes required');
    }
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', ...writeMethods].includes(method)) throw new TypeError('Unsupported Docs request method');
    if (writeMethods.has(method) && (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey))) {
      throw new TypeError('A separate business idempotency key is required for writes');
    }
    const headers = new Headers(options.headers);
    if (forbiddenHeaders.some((header) => headers.has(header))) throw new TypeError('Caller-supplied session credentials are not accepted');
    if (headers.has('Idempotency-Key')) throw new TypeError('Use the explicit idempotencyKey option');
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const proof = await adapter.createIntrospectionProof([...scopes]);
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (typeof proof?.proofHeader !== 'string' || !proof.proofHeader.trim() || /[\r\n]/.test(proof.proofHeader)) {
      throw new Error('Wallet SDK returned no usable session proof');
    }
    headers.set(proofHeaderName, proof.proofHeader);
    if (idempotencyKey !== undefined) headers.set('Idempotency-Key', idempotencyKey);
    // Never introspect locally, follow redirects, attach ambient credentials,
    // cache a response, or retry a consumed proof automatically.
    return fetchImpl(url.href, {...options, method, headers, signal, credentials: 'omit', redirect: 'error', cache: 'no-store'});
  };
}
