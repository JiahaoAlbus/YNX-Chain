import {createHash} from 'node:crypto';

// Closure for the weekly-v3 candidate builder accidentally omitted from main.
// The list is exact for the Finance server static map and reviewable
// source entries used to generate standalone browser/authority bundles.
export const runtimeFiles=Object.freeze([
  'app.js',
  'evm-read-session.js',
  'evm-subject.js',
  'finance-locale.js',
  'health.json',
  'index.html',
  'manifest.webmanifest',
  'order-wallet-entry.js',
  'order-wallet.js',
  'order-opaque.js',
  'product-catalog.js',
  'read-sources.js',
  'styles.css',
  'vercel.json',
  'wallet-auth-entry.js',
  'wallet-auth.js',
  'ynx-logo.png',
]);

export const authorityRuntimeFiles=Object.freeze([
  Object.freeze({source:'apps/finance/scripts/evm-read-browser-entry.mjs',destination:'authority-runtime/apps/finance/scripts/evm-read-browser-entry.mjs'}),
  Object.freeze({source:'apps/finance/scripts/evm-subject-browser-entry.mjs',destination:'authority-runtime/apps/finance/scripts/evm-subject-browser-entry.mjs'}),
  Object.freeze({source:'apps/finance/scripts/evm-read-session-authority.mjs',destination:'authority-runtime/apps/finance/scripts/evm-read-session-authority.mjs'}),
  Object.freeze({source:'apps/finance/scripts/evm-subject-authority.mjs',destination:'authority-runtime/apps/finance/scripts/evm-subject-authority.mjs'}),
  Object.freeze({source:'apps/finance/scripts/evm-product-login-authority.bundle.mjs',destination:'authority-runtime/apps/finance/scripts/evm-product-login-authority.bundle.mjs'}),
  Object.freeze({source:'apps/finance/scripts/evm-read-session-authority.bundle.mjs',destination:'authority-runtime/apps/finance/scripts/evm-read-session-authority.bundle.mjs'}),
  Object.freeze({source:'apps/finance/scripts/evm-subject-authority.bundle.mjs',destination:'authority-runtime/apps/finance/scripts/evm-subject-authority.bundle.mjs'}),
  Object.freeze({source:'apps/finance/scripts/finance-endpoint-authority-v2.mjs',destination:'authority-runtime/apps/finance/scripts/finance-endpoint-authority-v2.mjs'}),
  Object.freeze({source:'apps/finance/authority/adapter.mjs',destination:'authority-runtime/apps/finance/authority/adapter.mjs'}),
  Object.freeze({source:'apps/finance/authority/config.mjs',destination:'authority-runtime/apps/finance/authority/config.mjs'}),
  Object.freeze({source:'apps/finance/authority/checkpoint-node.mjs',destination:'authority-runtime/apps/finance/authority/checkpoint-node.mjs'}),
  Object.freeze({source:'sdk/js/endpoint-authority-v2.js',destination:'authority-runtime/sdk/js/endpoint-authority-v2.js'}),
]);

export function sha256(value){
  return createHash('sha256').update(value).digest('hex');
}
