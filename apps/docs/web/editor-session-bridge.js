import {loadDocsBrowserSession, docsSessionBinding} from './product-session-client.js';
import {createDocsSessionTransport} from './product-session-transport.js';
import {createDocsAuthorization} from './editor-authorization.js';
import {discoverWalletProviders} from './vendor/standard-wallet-browser.mjs';
import {withDocsPendingLock} from './pending-operation-lock.js';
import {createDocsWriteClient, docsWriteBodyMode, docsWriteScopesFor} from './product-session-write-client.js';
export {createDocsLocalExport} from './document-export.js';
export {docsText, mountDocsLanguage} from './editor-language.js';

export function createDocsEditorBridge({adapter, configuration, environment = globalThis, discover = discoverWalletProviders, changed = () => {}}) {
  const transport = createDocsSessionTransport({adapter, origin: docsSessionBinding.origin, fetchImpl: environment.fetch.bind(environment)});
  const writer = createDocsWriteClient({adapter, origin: docsSessionBinding.origin, fetchImpl: environment.fetch.bind(environment)});
  let invalid = false, reviewedId = null, reviewedSnapshot = null, writing = false;
  const identity = () => !invalid && adapter.client.current?.status === 'connected' ? adapter.client.current.session.sessionBinding : '';
  function fail(message, status, code) { const error = new Error(message); error.status = status; error.code = code; return error; }
  const pendingKey = () => `ynx.docs.v2.pending.${adapter.client.current.session.account}`;
  const authorization = createDocsAuthorization({adapter, discover, environment, changed(state) {
    invalid = state?.status !== 'connected'; changed(state);
  }});
  return {
    authorize() {
      // Non-secret access selection lets the original native callback construct
      // the same scoped SDK client; it never substitutes for SDK verification.
      environment.localStorage.setItem(`ynx.docs.v2.access.${docsSessionBinding.authority}`, 'edit');
      return authorization.approve();
    },
    cancelAuthorization() { return authorization.cancel(); },
    restore() { return authorization.restore(); },
    get revocationPending() { return authorization.revocationPending; },
    get identity() { return identity(); },
    get account() { return identity() ? adapter.client.current.session.account : ''; },
    get canBrowseTrash() { return Boolean(identity() && configuration.apiReadEnabled && configuration.trashListEnabled === true); },
    get canCopy() { return Boolean(this.canWrite && ['docs.read', 'files.read'].every((scope) => adapter.client.current.session.scopes.includes(scope))); },
    get canWrite() { return Boolean(identity() && configuration.apiWriteEnabled && ['docs.write', 'files.write'].every((scope) => adapter.client.current.session.scopes.includes(scope))); },
    get hasPendingWrite() {
      if (!identity()) return false;
      try { return Boolean(environment.localStorage.getItem(pendingKey())); } catch { return true; }
    },
    getPendingWrite() {
      if (!identity()) return null;
      const snapshot = environment.localStorage.getItem(pendingKey()) || null;
      const pending = JSON.parse(snapshot || 'null');
      if (pending) writer.resumePrepared(pending.operation);
      return pending ? {...pending, snapshot} : null;
    },
    async retryPendingWrite(snapshot) {
      if (typeof snapshot !== 'string' || !snapshot) throw fail('Review the original operation before retrying.', 409, 'PENDING_OPERATION_CHANGED');
      const pending = JSON.parse(snapshot);
      if (!pending) throw fail('No pending operation.', 409, 'NO_PENDING_WRITE');
      writer.resumePrepared(pending.operation);
      return this.request(pending.operation.path.slice('/api/v1'.length), {method: pending.operation.method, body: pending.operation.body, pendingSnapshot: snapshot});
    },
    async request(path, options = {}) {
      if (!identity()) throw fail('Authorize Docs Product Session before accessing documents.', 401, 'SESSION_INACTIVE');
      const requestIdentity = identity();
      const method = (options.method || 'GET').toUpperCase();
      const url = new URL('/api/v1' + path, docsSessionBinding.origin);
      const read = method === 'GET' && (/^\/api\/v1\/objects$/.test(url.pathname) || /^\/api\/v1\/objects\/[^/]+(?:\/(?:content|versions|comments))?$/.test(url.pathname));
      const write = Boolean(docsWriteBodyMode(method, '/api/v1' + path));
      if (!read && !write) throw fail('This action is not yet supported by the Docs v2 backend.', 403, 'V2_ROUTE_NOT_ENABLED');
      if (read && !configuration.apiReadEnabled) throw fail('Docs v2 read API is not enabled on this deployment.', 503, 'PRODUCT_SESSION_V2_DISABLED');
      if (write && !this.canWrite) throw fail('Editing requires an enabled write API and a new explicit editing authorization.', 403, 'DOCS_EDIT_AUTHORIZATION_REQUIRED');
      if (write && !docsWriteScopesFor(method, '/api/v1' + path).every((scope) => adapter.client.current.session.scopes.includes(scope))) throw fail('Copy requires read and write authorization.', 403, 'DOCS_COPY_AUTHORIZATION_REQUIRED');
      if (write && writing) throw fail('Another write is still in progress.', 409, 'WRITE_IN_PROGRESS');
      if (write) writing = true;
      try {
        if (write) {
          const key = pendingKey();
          return await withDocsPendingLock(environment, key, async () => {
          if (identity() !== requestIdentity) throw fail('Session changed. Review the operation again.', 409, 'PENDING_OPERATION_CHANGED');
          const raw = environment.localStorage.getItem(key);
          if (options.pendingSnapshot !== undefined && raw !== options.pendingSnapshot) throw fail('The pending operation changed in another tab. Review it again before retrying.', 409, 'PENDING_OPERATION_CHANGED');
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
            if (identity() !== requestIdentity) throw fail('Session changed. The write receipt must be reconciled for its original account.', 409, 'SESSION_CHANGED');
            const retained = JSON.parse(environment.localStorage.getItem(key) || 'null');
            if (retained?.operation?.idempotencyKey === pending.operation.idempotencyKey) environment.localStorage.removeItem(key);
            return result.object;
          } catch (error) {
            if (error.reconciliationRequired || error.current) {
              pending.blocked = true; pending.current = error.current || null;
              const retained = JSON.parse(environment.localStorage.getItem(key) || 'null');
              if (retained?.operation?.idempotencyKey === pending.operation.idempotencyKey) environment.localStorage.setItem(key, JSON.stringify(pending));
            }
            if (error.current) error.body = {current: error.current};
            throw error;
          }
          });
        }
        const readSnapshot = environment.localStorage.getItem(pendingKey()) || null;
        const response = await transport('/api/v1' + path, {scopes: ['docs.read', 'files.read']});
        const type = response.headers.get('content-type') || '';
        const body = response.ok && url.pathname.endsWith('/content') ? await response.blob() : type.includes('json') ? await response.json() : await response.blob();
        if (!response.ok) {
          const error = fail('Docs document access was not confirmed.', response.status, body?.code);
          error.body = body; throw error;
        }
        if (identity() !== requestIdentity) throw fail('Session changed. Read the document again.', 409, 'SESSION_CHANGED');
        if (url.pathname.endsWith('/content')) { reviewedId = decodeURIComponent(url.pathname.split('/')[4]); reviewedSnapshot = readSnapshot; }
        return body;
      } catch (error) {
        if (error.status === 401 || ['SESSION_EXPIRED', 'SESSION_INACTIVE'].includes(error.code)) invalid = true;
        throw error;
      } finally {
        if (write) writing = false;
      }
    },
    async resolveReviewedConflict() {
      const requestIdentity = identity();
      if (!requestIdentity) throw fail('Approve Docs before resolving a conflict.',401,'SESSION_INACTIVE');
      const key = pendingKey();
      return withDocsPendingLock(environment, key, () => {
      if (identity() !== requestIdentity) throw fail('Session changed. Read the original document again.',409,'SESSION_CHANGED');
      const raw = environment.localStorage.getItem(key) || null;
      const pending = JSON.parse(raw || 'null');
      if (!pending) return;
      if (raw !== reviewedSnapshot || !pending.blocked || !reviewedId || pending.current?.id !== reviewedId) throw Error('The pending write must be reconciled with its actual server document first.');
      environment.localStorage.removeItem(key); reviewedId = null; reviewedSnapshot = null;
      });
    },
    async disconnect() { invalid = true; return authorization.cancel(true); },
    close() { authorization.close(); },
  };
}

export async function loadDocsEditorBridge(environment = globalThis, changed = () => {}) {
  const response = await environment.fetch('/wallet-session-config.json', {cache: 'no-store', credentials: 'omit', redirect: 'error'});
  if (!response.ok) throw Error('Docs session configuration is unavailable.');
  const configuration = await response.json();
  const adapter = await loadDocsBrowserSession({environment, access:'edit'});
  try { const bridge = createDocsEditorBridge({adapter, configuration, environment, changed}); await bridge.restore(); return bridge; }
  catch (error) { adapter.close(); throw error; }
}
