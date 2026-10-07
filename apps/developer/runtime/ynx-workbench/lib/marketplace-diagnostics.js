'use strict';

// Registry errors cross JSON-RPC, which otherwise drops Error.cause. Do not
// serialize URLs, search terms, headers, response bodies or arbitrary messages.
const codes = new Set(['EPERM', 'EACCES', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED',
  'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID']);
const installed = new WeakSet();

function failureCodes(error) {
  const queue = [error], seen = new Set(), found = new Set();
  for (let i = 0; i < queue.length && i < 16; i++) {
    const value = queue[i];
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (codes.has(value.code)) found.add(value.code);
    if (value.cause) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors.slice(0, 8));
  }
  return [...found];
}

function installOn(prototype) {
  if (installed.has(prototype)) return;
  installed.add(prototype);
  for (const operation of ['search', 'query']) {
    const original = prototype[operation];
    prototype[operation] = async function (...args) {
      try { return await original.apply(this, args); }
      catch (cause) {
        const detail = failureCodes(cause).join(',') || 'UNCLASSIFIED';
        // Diagnostics must not change successful requests or replace the
        // original failure when a logger is unavailable during shutdown.
        try { this.logger?.warn(`YNX_MARKETPLACE operation=${operation} codes=${detail}`); } catch { /* retain request failure */ }
        throw new Error(`Extension registry ${operation} failed (${detail}). Check the IDE connection diagnostics and retry.`, { cause });
      }
    };
  }
}

module.exports = { failureCodes, installOn };
