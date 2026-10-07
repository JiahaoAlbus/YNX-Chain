// Pure request policy for review. No network access or IPC is enabled here.
const paths = { search: '/api/-/search', query: '/api/v2/-/query' };
const searchKeys = new Set(['query', 'category', 'size', 'offset', 'sortOrder', 'sortBy', 'includeAllVersions']);
const queryKeys = new Set(['namespaceName', 'extensionName', 'extensionVersion', 'extensionId', 'extensionUuid', 'namespaceUuid', 'includeAllVersions', 'targetPlatform', 'size', 'offset']);
export const catalogLimits = Object.freeze({ maxBytes: 4 * 1024 * 1024, timeoutMs: 15000, maxUrlBytes: 2048 });

export function catalogRequest(operation, options = {}) {
  if (!Object.hasOwn(paths, operation) || !options || typeof options !== 'object' || Array.isArray(options)) throw Error('Unsupported catalog request.');
  const allowed = operation === 'search' ? searchKeys : queryKeys;
  const url = new URL(paths[operation], 'https://open-vsx.org');
  for (const [key, value] of Object.entries(options)) {
    if (!allowed.has(key)) throw Error('Unsupported catalog option.');
    if (value === undefined) continue;
    if (key === 'size' || key === 'offset') {
      if (!Number.isSafeInteger(value) || value < 0 || value > (key === 'size' ? 100 : 100000)) throw Error('Invalid catalog page.');
    } else if (key === 'includeAllVersions') {
      if (typeof value !== 'boolean' && !(operation === 'query' && value === 'links')) throw Error('Invalid catalog version option.');
    } else {
      if (typeof value !== 'string' || Buffer.byteLength(value) > 512 || /[\x00-\x1f\x7f]/.test(value)) throw Error('Invalid catalog text.');
      if (key === 'sortOrder' && !['asc', 'desc'].includes(value)) throw Error('Invalid catalog sort order.');
      if (key === 'sortBy' && !['averageRating', 'downloadCount', 'relevance', 'timestamp'].includes(value)) throw Error('Invalid catalog sort key.');
    }
    url.searchParams.set(key, String(value));
  }
  if (!url.searchParams.has('size')) url.searchParams.set('size', '30');
  if (Buffer.byteLength(url.href) > catalogLimits.maxUrlBytes) throw Error('Catalog request too large.');
  return Object.freeze({ url: url.href, method: 'GET', redirect: 'error', credentials: 'omit', headers: Object.freeze({ Accept: 'application/json' }) });
}

// Response URLs are data, never followed by this catalog-only capability.
export function decodeCatalogResponse(bytes, contentType) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > catalogLimits.maxBytes) throw Error('Catalog response too large or invalid.');
  if (!/^application\/json(?:\s*;|$)/i.test(contentType || '')) throw Error('Catalog returned a non-JSON response.');
  const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!result || typeof result !== 'object' || !Array.isArray(result.extensions) || result.extensions.length > 100) throw Error('Invalid catalog result.');
  for (const key of ['offset', 'totalSize']) if (result[key] !== undefined && (!Number.isSafeInteger(result[key]) || result[key] < 0)) throw Error('Invalid catalog pagination.');
  for (const entry of result.extensions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.name !== 'string' || typeof entry.namespace !== 'string' || entry.name.length > 256 || entry.namespace.length > 256) throw Error('Invalid catalog entry.');
  }
  return result;
}
