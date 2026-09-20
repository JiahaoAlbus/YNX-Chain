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

export function sha256(value){
  return createHash('sha256').update(value).digest('hex');
}
