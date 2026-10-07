'use strict';

// Registry errors cross JSON-RPC. Inspect bounded causes locally; never
// serialize URLs, search terms, headers, response bodies or arbitrary messages.
const codes = new Set(['EPERM', 'EACCES', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED',
  'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID']);
const installed = new WeakSet();
const categories = new Set(['POLICY', 'QUOTA', 'CHANNEL_UNAVAILABLE', 'PROTOCOL',
  'CANCELLED', 'TIMEOUT', 'HTTP_3XX', 'HTTP_4XX', 'HTTP_5XX', 'HTTP_OTHER',
  'RESPONSE_SIZE', 'RESPONSE_DECODE', 'TRANSPORT_FAILURE', 'TRANSPORT_UNCLASSIFIED']);
function markFailure(category, error = Error('Extension catalog channel unavailable.')) {
  error.catalogCategory = categories.has(category) ? category : 'TRANSPORT_UNCLASSIFIED';
  return error;
}
function failureEnvelope(error) {
  const safeCodes = failureCodes(error);
  return { version: 1, category: categories.has(error?.catalogCategory) ? error.catalogCategory : safeCodes.length ? 'TRANSPORT_FAILURE' : 'TRANSPORT_UNCLASSIFIED', codes: safeCodes };
}
function validEnvelope(value) {
  return value && Object.keys(value).sort().join(',') === 'category,codes,version'
    && value.version === 1 && categories.has(value.category) && Array.isArray(value.codes)
    && value.codes.length <= codes.size && new Set(value.codes).size === value.codes.length
    && value.codes.every(code => codes.has(code));
}
function errorFromEnvelope(value) {
  if (!validEnvelope(value)) throw markFailure('PROTOCOL');
  const error = markFailure(value.category);
  error.catalogCodes = [...value.codes];
  return error;
}

function failureCodes(error) {
  const queue = [error], seen = new Set(), found = new Set();
  for (let i = 0; i < queue.length && i < 16; i++) {
    const value = queue[i];
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (codes.has(value.code)) found.add(value.code);
    if (Array.isArray(value.catalogCodes)) for (const code of value.catalogCodes.slice(0, codes.size)) if (codes.has(code)) found.add(code);
    if (value.cause) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors.slice(0, 8));
  }
  return [...found];
}

function installOn(prototype) {
  if (installed.has(prototype)) return;
  installed.add(prototype);
  for (const operation of ['search', 'query', 'findLatestCompatibleExtension']) {
    const original = prototype[operation];
    if (typeof original !== 'function') continue;
    prototype[operation] = async function (...args) {
      try { return await original.apply(this, args); }
      catch (cause) {
        const envelope = failureEnvelope(cause);
        const detail = [envelope.category, ...envelope.codes].join(',');
        // Diagnostics must not change successful requests or replace the
        // original failure when a logger is unavailable during shutdown.
        try { this.logger?.warn(`YNX_MARKETPLACE operation=${operation} codes=${detail}`); } catch { /* retain request failure */ }
        // Do not retain cause on the cross-RPC error: different codec setups
        // can serialize nested errors, including provider URLs and credentials.
        throw new Error(`Extension registry ${operation} failed (${detail}). Check the IDE connection diagnostics and retry.`);
      }
    };
  }
}

module.exports = { failureCodes, installOn, markFailure, failureEnvelope, validEnvelope, errorFromEnvelope };
