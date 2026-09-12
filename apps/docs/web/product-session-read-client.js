import {createDocsSessionTransport} from './product-session-transport.js';

// Cloud owner-confirmed candidate contract. Deployment remains gated separately.
export const docsReadScopes = Object.freeze(['docs.read', 'files.read']);
export function createDocsReadClient({adapter, origin, fetchImpl = globalThis.fetch}) {
  const request = createDocsSessionTransport({adapter, origin, fetchImpl});
  async function read(path, type, signal) {
    const response = await request(path, {scopes: [...docsReadScopes], signal});
    if (!response.ok) {
      const error = new Error(response.status === 401 ? 'Docs session authorization is required.'
        : response.status === 403 ? 'This Docs resource is not authorized.'
        : 'Docs document service is unavailable. Retry when ready.');
      error.status = response.status;
      throw error;
    }
    return type === 'text' ? response.text() : response.json();
  }
  function objectPath(id) {
    if (typeof id !== 'string' || !id.length || id.length > 256) throw new TypeError('Document identifier required');
    return `/api/v1/objects/${encodeURIComponent(id)}`;
  }
  return {
    async list({parentId = '', query = '', recent = false, signal} = {}) {
      const params = recent ? new URLSearchParams({view: 'recent'}) : new URLSearchParams({parentId, q: query});
      const objects = await read(`/api/v1/objects?${params}`, 'json', signal);
      if (!Array.isArray(objects)) throw new Error('Docs service returned an invalid document list.');
      return objects.filter((object) => object && typeof object.id === 'string' && typeof object.name === 'string' && ['doc', 'folder'].includes(object.kind));
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
