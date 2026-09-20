import {createHash} from 'node:crypto';

// Closure for the weekly-v3 candidate builder accidentally omitted from main.
// The list is exact for the Finance server static map plus the two
// reviewable source entries used to generate the standalone browser bundles.
export const runtimeFiles=Object.freeze([
  'app.js',
  'health.json',
  'index.html',
  'manifest.webmanifest',
  'order-wallet-entry.js',
  'order-wallet.js',
  'read-sources.js',
  'styles.css',
  'vercel.json',
  'wallet-auth-entry.js',
  'wallet-auth.js',
  'ynx-logo.png',
]);

export const authorityRuntimeFiles=Object.freeze([
  Object.freeze({source:'apps/finance/scripts/finance-endpoint-authority-v2.mjs',destination:'authority-runtime/apps/finance/scripts/finance-endpoint-authority-v2.mjs'}),
  Object.freeze({source:'apps/finance/authority/adapter.mjs',destination:'authority-runtime/apps/finance/authority/adapter.mjs'}),
  Object.freeze({source:'apps/finance/authority/config.mjs',destination:'authority-runtime/apps/finance/authority/config.mjs'}),
  Object.freeze({source:'apps/finance/authority/checkpoint-node.mjs',destination:'authority-runtime/apps/finance/authority/checkpoint-node.mjs'}),
  Object.freeze({source:'sdk/js/endpoint-authority-v2.js',destination:'authority-runtime/sdk/js/endpoint-authority-v2.js'}),
]);

export function sha256(value){
  return createHash('sha256').update(value).digest('hex');
}
