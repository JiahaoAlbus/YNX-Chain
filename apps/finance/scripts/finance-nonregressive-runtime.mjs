import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const preservedFrontendSource = '75f0299aaf53263e4279acf93e9a06db9d055e38';
export const preservedFrontend = Object.freeze({
  'index.html': { bytes: 11427, sha256: 'c1fc45eecd7f88de6fc3e049d15161b8d4e9878e31f20c977fc52b383a18ed53' },
  'app.js': { bytes: 17371, sha256: 'a1ed94de08fc5b73f075cf35c1b17481e24b6046732ad92d82209959b694c6d6' },
  'read-sources.js': { bytes: 10920, sha256: 'e19b7b266c14b181a4d88b10c6e1975398bdafb77660272f37ba22b48fc18c70' },
  'styles.css': { bytes: 13935, sha256: 'bd01b920fee3693204a63aed364c27becf4c9c84f3ee1ed9dd3e2d35a39b5d9f' },
  'manifest.webmanifest': { bytes: 241, sha256: '3f7bec35f54aad6a095151e9d4d553e7ea10cbbbcc9e16f0f3fe7abd242b6d05' },
  'ynx-logo.png': { bytes: 104171, sha256: 'df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d' },
  'wallet-auth.js': { bytes: 66997, sha256: 'be5c90e938e5d5b6e181199f2e1e3949b8f343c4e1af4d8aceab27b1ed41bf6d' }
});
export const runtimeFiles = Object.freeze([...Object.keys(preservedFrontend), 'health.json', 'vercel.json', 'wallet-auth-entry.js']);

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
export function validatePreservedFrontend(webRoot) {
  for (const [relativePath, expected] of Object.entries(preservedFrontend)) {
    const path = join(webRoot, relativePath);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`FINANCE_FRONTEND_RESOURCE_MISSING:${relativePath}`);
    const body = readFileSync(path);
    if (body.length !== expected.bytes || sha256(body) !== expected.sha256) throw new Error(`FINANCE_FRONTEND_RESOURCE_REGRESSION:${relativePath}`);
  }
  for (const forbidden of ['wallet-connect.js', 'wallet-connect-entry.js']) {
    if (existsSync(join(webRoot, forbidden))) throw new Error(`FINANCE_LEGACY_WALLET_CONNECT_REINTRODUCED:${forbidden}`);
  }
  const html = readFileSync(join(webRoot, 'index.html'), 'utf8');
  if (!html.includes('wallet-auth.js') || html.includes('wallet-connect.js')) throw new Error('FINANCE_WALLET_SCRIPT_BINDING_REGRESSION');
  return true;
}
export function validateBuildIdentity(identity, expected) {
  for (const key of ['sourceCommit', 'release', 'buildTime', 'frontendSourceCommit']) {
    if (identity[key] !== expected[key]) throw new Error(`FINANCE_BUILD_IDENTITY_MISMATCH:${key}`);
  }
  if (!/^[0-9a-f]{40}$/.test(identity.sourceCommit)) throw new Error('FINANCE_BUILD_IDENTITY_SOURCE_INVALID');
  if (identity.frontendSourceCommit !== preservedFrontendSource) throw new Error('FINANCE_BUILD_IDENTITY_FRONTEND_INVALID');
  return true;
}
