import https from 'node:https';
import { lookup } from 'node:dns';
import { isIP, BlockList } from 'node:net';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { catalogRequest, decodeCatalogResponse, catalogLimits } from './marketplace-catalog-policy.mjs';
import diagnostics from '../runtime/ynx-workbench/lib/marketplace-diagnostics.js';
import readme from '../runtime/ynx-workbench/lib/marketplace-readme.js';
const { markFailure } = diagnostics;
const failure = (category, message) => markFailure(category, Error(message));

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(address, prefix, 'ipv4');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
export function isPublicCatalogAddress(address) {
  if (isIP(address) === 4) return !blocked.check(address, 'ipv4');
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, 'ipv6');
}
let inflight = 0, rateStart = Date.now(), rateCount = 0;
export function fetchCatalog(operation, options, signal) {
  let request;
  try { request = catalogRequest(operation, options); } catch (error) { throw markFailure('POLICY', error); }
  const maxBytes = request.maxBytes || catalogLimits.maxBytes;
  if (Date.now() - rateStart >= 1000) { rateStart = Date.now(); rateCount = 0; }
  if (signal?.aborted) return Promise.reject(failure('CANCELLED', 'Catalog request cancelled.'));
  if (inflight >= 8 || ++rateCount > 16) return Promise.reject(failure('QUOTA', 'Catalog request unavailable.'));
  inflight++;
  return new Promise((resolve, reject) => {
    let req, response, decoded, settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      req?.destroy(); response?.destroy(); if (decoded !== response) decoded?.destroy();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(failure('CANCELLED', 'Catalog request cancelled.'));
    const timer = setTimeout(() => finish(markFailure('TIMEOUT', Object.assign(Error('Catalog request timed out.'), { code: 'ETIMEDOUT' }))), catalogLimits.timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const send = (url, allowReadmeRedirect) => { req = https.request(url, {
        method: 'GET', headers: request.headers, agent: false, rejectUnauthorized: true,
        // Resolve once, validate all candidates, and give only these addresses
        // to the connection. No proxy env, redirects or caller-selected host.
        lookup(hostname, lookupOptions, callback) {
          if (hostname !== new URL(url).hostname || !['open-vsx.org', ...operation === 'readme' ? ['openvsx.eclipsecontent.org'] : []].includes(hostname)) return callback(failure('POLICY', 'Catalog host rejected.'));
          lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
            if (error) return callback(error);
            if (settled || !addresses.length || addresses.some(value => !isPublicCatalogAddress(value.address))) return callback(failure('POLICY', 'Catalog address rejected.'));
            if (lookupOptions.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          });
        },
      }, incoming => {
        if (settled) { incoming.destroy(); return; }
        response = incoming;
        if (incoming.statusCode === 302 && allowReadmeRedirect) {
          let target;
          try { target = readme.officialReadmeRedirect(request.url, incoming.headers.location); }
          catch (error) { return finish(markFailure('POLICY', error)); }
          incoming.destroy(); req?.destroy();
          send(target, false); return;
        }
        if (incoming.statusCode < 200 || incoming.statusCode >= 300) return finish(failure([3,4,5].includes(Math.floor(incoming.statusCode / 100)) ? `HTTP_${Math.floor(incoming.statusCode / 100)}XX` : 'HTTP_OTHER', 'Catalog HTTP response rejected.'));
        if (Number(incoming.headers['content-length']) > maxBytes) return finish(failure('RESPONSE_SIZE', 'Catalog response too large.'));
        const encoding = incoming.headers['content-encoding'] || 'identity';
        const factories = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress };
        if (encoding !== 'identity' && !Object.hasOwn(factories, encoding)) return finish(failure('RESPONSE_DECODE', 'Catalog encoding rejected.'));
        decoded = encoding === 'identity' ? incoming : factories[encoding]();
        let compressedBytes = 0, bytes = 0; const chunks = [];
        incoming.on('data', chunk => { compressedBytes += chunk.length; if (compressedBytes > maxBytes) finish(failure('RESPONSE_SIZE', 'Catalog response too large.')); });
        incoming.on('error', error => finish(error)); incoming.on('aborted', () => finish(Error('Catalog response interrupted.')));
        decoded.on('error', error => finish(decoded === incoming ? error : markFailure('RESPONSE_DECODE', error)));
        decoded.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) return finish(failure('RESPONSE_SIZE', 'Catalog response too large.')); chunks.push(chunk); });
        decoded.on('end', () => {
          try { finish(null, (operation === 'readme' ? readme.decodeReadme : decodeCatalogResponse)(Buffer.concat(chunks), incoming.headers['content-type'])); }
          catch (error) { finish(markFailure('RESPONSE_DECODE', error)); }
        });
        if (decoded !== incoming) incoming.pipe(decoded);
      });
      req.on('error', error => finish(error)); req.end();
      };
      send(request.url, operation === 'readme');
      if (signal?.aborted) cancel();
    } catch (error) { finish(error); }
  }).finally(() => { inflight--; });
}
