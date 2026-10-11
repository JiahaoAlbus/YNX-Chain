import https from 'node:https';
import {lookup} from 'node:dns';
import {rpcURL, publicAddress, exactObject, multiError} from './multichain-config.mjs';
const fail = (code, message) => multiError(code, message ?? 'The selected chain could not be verified.');
function tronRead(path, body) {
  if (['/wallet/getnowblock','/wallet/getchainparameters'].includes(path)) {
    exactObject(body,[]);
  } else if (path === '/wallet/getblockbynum') {
    exactObject(body, ['num']); if (!Number.isSafeInteger(body.num) || body.num < 0) throw fail('FAMILY_RPC_INPUT');
  } else if (['/wallet/gettransactionbyid', '/wallet/gettransactioninfobyid'].includes(path)) {
    exactObject(body, ['value']); if (!/^[0-9a-fA-F]{64}$/.test(body.value)) throw fail('FAMILY_RPC_INPUT');
  } else if (['/wallet/getaccount', '/wallet/getaccountresource'].includes(path)) {
    exactObject(body, ['address', 'visible']); if (!/^41[0-9a-f]{40}$/.test(body.address) || body.visible !== false) throw fail('FAMILY_RPC_INPUT');
  } else if (['/wallet/triggerconstantcontract','/wallet/estimateenergy'].includes(path)) {
    exactObject(body, ['owner_address', 'contract_address', 'function_selector', 'parameter', 'visible']);
    const transfer=body.function_selector==='transfer(address,uint256)'&&typeof body.parameter==='string'&&/^0{24}[0-9a-f]{40}[0-9a-f]{64}$/.test(body.parameter)&&!/^0{64}$/.test(body.parameter.slice(64));
    const permitted = path==='/wallet/estimateenergy'?transfer:transfer||(body.function_selector === 'balanceOf(address)' ? typeof body.parameter === 'string' && /^[0-9a-f]{64}$/.test(body.parameter) : ['name()', 'symbol()', 'decimals()'].includes(body.function_selector) && body.parameter === '');
    if (![body.owner_address, body.contract_address].every(v => typeof v === 'string' && /^41[0-9a-f]{40}$/.test(v)) || !permitted || body.visible !== false) throw fail('FAMILY_RPC_INPUT');
  } else throw fail('FAMILY_RPC_READ_ONLY');
}
/** Fixed selected endpoint, validated DNS socket, bounded responses, no redirects,
 * retries, auth headers, proxy, signature or broadcast routes. */
export function createFamilyReadTransport({family, networkId, baseURL, request = https.request, dnsLookup = lookup, timeout = 12000, maxBytes = 1000000}) {
  if (!['bitcoin', 'tron'].includes(family) || typeof networkId !== 'string' || !networkId || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 5000000) throw fail('FAMILY_RPC_INPUT');
  const base = new URL(rpcURL(baseURL));
  async function call(route, method, body, mode, signal) {
    if (signal?.aborted) throw fail('FAMILY_RPC_CANCELLED');
    const target = new URL(base.href); target.pathname = base.pathname.replace(/\/$/, '') + route;
    const text = body === null ? null : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      let req, settled = false;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
      const abort = () => { req?.destroy(); finish(fail('FAMILY_RPC_CANCELLED')); };
      const timer = setTimeout(() => { req?.destroy(); finish(fail('FAMILY_RPC_TIMEOUT')); }, timeout);
      const lookupPublic = (hostname, options, callback) => dnsLookup(hostname, {all: true, verbatim: true}, (error, addresses) => {
        if (error) return callback(fail('FAMILY_RPC_UNAVAILABLE'));
        if (!addresses?.length || addresses.some(r => !publicAddress(r.address))) return callback(fail('FAMILY_RPC_PRIVATE'));
        const family = typeof options === 'number' ? options : options?.family;
        const selected = addresses.filter(r => !family || r.family === family);
        if (!selected.length) return callback(fail('FAMILY_RPC_PRIVATE'));
        if (options?.all) return callback(null, selected); callback(null, selected[0].address, selected[0].family);
      });
      signal?.addEventListener('abort', abort, {once: true});
      try {
        req = request(target, {method, lookup: lookupPublic, agent: false, rejectUnauthorized: true, headers: text === null ? {'accept': mode === 'json' ? 'application/json' : 'text/plain'} : {'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'accept': 'application/json'}}, response => {
          const type = String(response.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase();
          if (response.statusCode !== 200 || mode === 'json' && type !== 'application/json' || mode === 'text' && !['text/plain', 'application/octet-stream'].includes(type) || response.headers?.['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.resume(); finish(fail('FAMILY_RPC_HTTP')); return; }
          let bytes = 0; const chunks = [];
          response.on('data', chunk => { const b = Buffer.from(chunk); bytes += b.length; if (bytes > maxBytes) { response.destroy(); finish(fail('FAMILY_RPC_RESPONSE_SIZE')); } else chunks.push(b); });
          response.on('error', () => finish(fail('FAMILY_RPC_UNAVAILABLE')));
          response.on('aborted', () => finish(fail('FAMILY_RPC_UNAVAILABLE')));
          response.on('end', () => { try { const value = Buffer.concat(chunks).toString('utf8'); finish(null, mode === 'json' ? JSON.parse(value) : value.trim()); } catch { finish(fail('FAMILY_RPC_INVALID')); } });
        });
        req.on('error', error => finish(fail(error?.code === 'FAMILY_RPC_PRIVATE' ? error.code : 'FAMILY_RPC_UNAVAILABLE')));
        req.end(text ?? undefined);
        if (signal?.aborted) abort();
      } catch { finish(fail('FAMILY_RPC_UNAVAILABLE')); }
    });
  }
  return family === 'bitcoin' ? async input => {
    exactObject(input, ['method', 'path', 'network', 'signal']);
    if (input.network !== networkId || input.method !== 'GET' || typeof input.path !== 'string' || !/^(?:\/block-height\/(?:0|[1-9][0-9]{0,9})|\/block\/[0-9a-f]{64}\/header|\/mempool\/txids|\/address\/(?:bc1|tb1)[a-z0-9]{6,87}\/utxo|\/tx\/[0-9a-f]{64}\/(?:hex|status|merkle-proof|outspend\/[0-9]{1,10}))$/.test(input.path) || input.path.startsWith('/block-height/') && Number(input.path.slice(14)) > 2147483647) throw fail('FAMILY_RPC_READ_ONLY');
    return call(input.path, 'GET', null, /(?:\/block-height\/[0-9]+|\/hex|\/header)$/.test(input.path) ? 'text' : 'json', input.signal);
  } : async (network, route, body) => {
    if (network?.id !== networkId) throw fail('FAMILY_RPC_NETWORK'); tronRead(route, body);
    return call(route, 'POST', body, 'json');
  };
}
