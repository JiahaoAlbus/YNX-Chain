import {loadDocsBrowserSession, docsSessionBinding} from './product-session-client.js';
import {createDocsSessionTransport} from './product-session-transport.js';
import {createDocsWriteClient} from './product-session-write-client.js';
export {createDocsLocalExport} from './document-export.js';

export function createDocsEditorBridge({adapter, configuration, environment = globalThis}) {
  const transport = createDocsSessionTransport({adapter, origin: docsSessionBinding.origin, fetchImpl: environment.fetch.bind(environment)});
  const writer = createDocsWriteClient({adapter, origin: docsSessionBinding.origin, fetchImpl: environment.fetch.bind(environment)});
  let invalid = false, reviewedId = null;
  const identity = () => !invalid && adapter.client.current?.status === 'connected' ? adapter.client.current.session.sessionBinding : '';
  function fail(message, status, code) { const error = new Error(message); error.status = status; error.code = code; return error; }
  const pendingKey = () => `ynx.docs.v2.pending.${adapter.client.current.session.account}`;
  return {
    get identity() { return identity(); },
    get canWrite() { return Boolean(identity() && configuration.apiWriteEnabled && ['docs.write', 'files.write'].every((scope) => adapter.client.current.session.scopes.includes(scope))); },
    async request(path, options = {}) {
      if (!identity()) throw fail('Authorize Docs Product Session before accessing documents.', 401, 'SESSION_INACTIVE');
      const method = (options.method || 'GET').toUpperCase();
      const url = new URL('/api/v1' + path, docsSessionBinding.origin);
      const read = method === 'GET' && (/^\/api\/v1\/objects$/.test(url.pathname) || /^\/api\/v1\/objects\/[^/]+(?:\/content)?$/.test(url.pathname));
      const write = (method === 'POST' && url.pathname === '/api/v1/objects') || (method === 'PUT' && /^\/api\/v1\/objects\/[^/]+\/document$/.test(url.pathname));
      if (!read && !write) throw fail('This action is not yet supported by the Docs v2 backend.', 403, 'V2_ROUTE_NOT_ENABLED');
      if (read && !configuration.apiReadEnabled) throw fail('Docs v2 read API is not enabled on this deployment.', 503, 'PRODUCT_SESSION_V2_DISABLED');
      if (write && !this.canWrite) throw fail('Editing requires an enabled write API and a new explicit editing authorization.', 403, 'DOCS_EDIT_AUTHORIZATION_REQUIRED');
      try {
        if (write) {
          const key = pendingKey();
          const raw = environment.localStorage.getItem(key);
          let pending = raw ? JSON.parse(raw) : null;
          if (pending?.blocked) throw fail('Read the server version and use conflict recovery before another write.', 409, 'WRITE_OUTCOME_UNCERTAIN');
          if (pending && (pending.operation.method !== method || pending.operation.path !== '/api/v1' + path || pending.operation.body !== options.body)) {
            throw fail('An earlier write is unconfirmed. Reconcile it on the Product Session page before submitting different content.', 409, 'WRITE_OUTCOME_UNCERTAIN');
          }
          if (!pending) {
            pending = {operation: {method, path: '/api/v1' + path, body: options.body, idempotencyKey: environment.crypto.randomUUID()}, blocked: false};
            environment.localStorage.setItem(key, JSON.stringify(pending));
          }
          try {
            const result = await writer.send(writer.resumePrepared(pending.operation));
            environment.localStorage.removeItem(key);
            return result.object;
          } catch (error) {
            if (error.reconciliationRequired || error.current) {
              pending.blocked = true; pending.current = error.current || null;
              environment.localStorage.setItem(key, JSON.stringify(pending));
            }
            if (error.current) error.body = {current: error.current};
            throw error;
          }
        }
        const response = await transport('/api/v1' + path, {scopes: ['docs.read', 'files.read']});
        const type = response.headers.get('content-type') || '';
        const body = type.includes('json') ? await response.json() : await response.blob();
        if (!response.ok) {
          const error = fail('Docs document access was not confirmed.', response.status, body?.code);
          error.body = body; throw error;
        }
        if (url.pathname.endsWith('/content')) reviewedId = decodeURIComponent(url.pathname.split('/')[4]);
        return body;
      } catch (error) {
        if (error.status === 401 || ['SESSION_EXPIRED', 'SESSION_INACTIVE'].includes(error.code)) invalid = true;
        throw error;
      }
    },
    resolveReviewedConflict() {
      const key = pendingKey();
      const pending = JSON.parse(environment.localStorage.getItem(key) || 'null');
      if (!pending) return;
      if (!pending.blocked || !reviewedId || pending.current?.id !== reviewedId) throw Error('The pending write must be reconciled with its actual server document first.');
      environment.localStorage.removeItem(key); reviewedId = null;
    },
    async disconnect() { const result = await adapter.client.disconnect(); invalid = result.status !== 'connected'; return result; },
    close() { adapter.close(); },
  };
}

export async function loadDocsEditorBridge(environment = globalThis) {
  const response = await environment.fetch('/wallet-session-config.json', {cache: 'no-store', credentials: 'omit', redirect: 'error'});
  if (!response.ok) throw Error('Docs session configuration is unavailable.');
  const configuration = await response.json();
  const accessKey = `ynx.docs.v2.access.${docsSessionBinding.authority}`;
  let access = 'read';
  try { if (environment.localStorage.getItem(accessKey) === 'edit') access = 'edit'; } catch {}
  const adapter = await loadDocsBrowserSession({environment, access});
  try { await adapter.client.restore(); return createDocsEditorBridge({adapter, configuration, environment}); }
  catch (error) { adapter.close(); throw error; }
}
