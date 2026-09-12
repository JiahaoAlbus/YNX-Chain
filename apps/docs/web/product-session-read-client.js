import {createDocsSessionTransport} from './product-session-transport.js';

// Cloud fixed contract 6d1479eead327025be106ec83f233f98a1f242a8.
// Source availability does not imply the deployment has enabled these routes.
export const docsReadScopes = Object.freeze(['docs.read', 'files.read']);
export function createDocsReadClient({adapter, origin, fetchImpl = globalThis.fetch}) {
  const request = createDocsSessionTransport({adapter, origin, fetchImpl});
  async function read(path, type, signal) {
    const response = await request(path, {scopes: [...docsReadScopes], signal});
    if (!response.ok) {
      let body;
      try { body = await response.json(); } catch {}
      const error = new Error(response.status === 401 ? 'Docs session authorization is required.'
        : response.status === 403 ? 'This Docs resource is not authorized.'
        : 'Docs document service is unavailable. Retry when ready.');
      error.status = response.status;
      if (typeof body?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(body.code)) error.code = body.code;
      throw error;
    }
    return type === 'text' ? response.text() : response.json();
  }
  function objectPath(id) {
    if (typeof id !== 'string' || !id.length || id.length > 256) throw new TypeError('Document identifier required');
    return `/api/v1/objects/${encodeURIComponent(id)}`;
  }
  return {
    async list({parentId = '', query = '', recent = false, cursor = '', limit = 50, signal} = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Docs page limit must be between 1 and 100');
      const params = recent ? new URLSearchParams({view: 'recent'}) : new URLSearchParams({parentId, q: query});
      params.set('limit', String(limit));
      if (cursor) params.set('cursor', cursor);
      const page = await read(`/api/v1/objects?${params}`, 'json', signal);
      if (!page || !Array.isArray(page.items) || (page.nextCursor != null && typeof page.nextCursor !== 'string')) throw new Error('Docs service returned an invalid document page.');
      return {...page, nextCursor: page.nextCursor || '', items: page.items.filter((object) => object && typeof object.id === 'string' && typeof object.name === 'string' && ['doc', 'folder'].includes(object.kind))};
    },
    async open(id, {signal} = {}) {
      const path = objectPath(id);
      const metadata = await read(path, 'json', signal);
      if (!metadata || metadata.id !== id || metadata.kind !== 'doc' || typeof metadata.name !== 'string') throw new Error('Docs service returned invalid document metadata.');
      const content = await read(`${path}/content`, 'text', signal);
      return {metadata, content};
    },
  };
}
