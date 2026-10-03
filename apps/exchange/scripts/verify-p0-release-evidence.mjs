import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repoRoot = resolve(appRoot, '../..');
const apkFlag = process.argv.indexOf('--apk');
const apkPath = apkFlag === -1 ? undefined : resolve(process.argv[apkFlag + 1] ?? '');
if (apkFlag !== -1 && !process.argv[apkFlag + 1]) throw new Error('--apk requires a path');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const read = path => readFile(resolve(appRoot, path));
const manifest = JSON.parse((await read('mobile/contract/public-endpoint-manifest.json')).toString('utf8'));
const release = JSON.parse((await read('product-release.json')).toString('utf8'));
const wallet = (await read('mobile/src/wallet.ts')).toString('utf8');
const api = (await read('mobile/src/api.ts')).toString('utf8');
const mobile = (await read('mobile/App.tsx')).toString('utf8');
const web = (await read('web/app.js')).toString('utf8');
const expectedManifestHash = '3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5';
const payload = { ...manifest };
delete payload.integrity;
const assert = (value, message) => { if (!value) throw new Error(message); };

assert(sha256(JSON.stringify(payload)) === expectedManifestHash, 'accepted endpoint manifest payload hash mismatch');
assert(manifest.integrity?.payloadSha256 === expectedManifestHash, 'endpoint manifest does not declare its accepted hash');
assert(manifest.sourceCommit === 'fa0ffd9bbbcc831438078be8e19cebff51b07e5e', 'endpoint manifest source commit mismatch');
assert(manifest.endpointStates?.products?.exchange?.status === 'PENDING', 'Exchange product endpoint may not be treated as released');
assert(release.releaseStates?.deployedPublic === false && release.releaseStates?.downloadHosted === false && release.releaseStates?.productionSigned === false && release.releaseStates?.storeReleased === false, 'release metadata attempts an unproven public claim');
for (const forbidden of ['sessions/complete', 'createGatewayChallenge', 'createProductSessionProof', 'wallet-auth.ynxweb4.com/v2']) assert(!wallet.includes(forbidden), `wallet runtime contains prohibited legacy route: ${forbidden}`);
assert(wallet.includes('encodeRequestDeepLink') && wallet.includes('parseAuthorizationCallbackURL'), 'Exchange must consume the canonical Wallet authorization builder and callback parser');
assert(!/(?:Linking\.)?openURL\(\s*['\"`]ynxwallet:\/\/authorize/.test(wallet), 'Exchange must not launch a naked Wallet authorization route');
assert(api.includes('API_UNAVAILABLE: Exchange product API is PENDING'), 'pending Exchange API does not fail closed');
assert(mobile.includes('productSessionUnavailable().message'), 'installed UI does not render private-service degradation separately');
// Historical mobile PENDING evidence is not authority for the current Web
// consumer. Permit only its exact bounded identity-only same-origin helper;
// private reads remain behind the separate original ProductSession SDK module.
const identityStart=web.indexOf('async function browserIdentityRequest(');
const identityEnd=web.indexOf('\nasync function restoreBrowserIdentity(',identityStart);
const identityHelper=web.slice(identityStart,identityEnd);
assert(identityStart>=0&&identityEnd>identityStart&&sha256(identityHelper)==='8953bb911714c9327690c25adf02d8415cdf91e0b2ade3dd7a5b7318a1e2f328'&&web.split(identityHelper).length===2, 'Web identity helper is not the exact bounded same-origin implementation');
const webShell=web.replace(identityHelper,'');
const identityCalls=[...webShell.matchAll(/\bbrowserIdentityRequest\(([^,)]+)/gu)];
assert(identityCalls.length>=4&&identityCalls.length<=8, 'Web identity call set is missing or unbounded');
for(const call of identityCalls)assert(["'config'","'account'","'logout'"].includes(call[1]), 'Web identity helper called a non-identity route');
assert(webShell.includes('No request was sent.') && !webShell.includes('fetch(') && !webShell.includes('/api/'), 'web shell retains a direct product API route');

const report = {
  schemaVersion: 1,
  classification: 'local-release-evidence-verification',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  endpointManifest: { sourceCommit: manifest.sourceCommit, payloadSha256: expectedManifestHash, exchangeProductStatus: manifest.endpointStates.products.exchange.status },
  connectivityBoundary: { standardWalletRuntime: 'SOURCE_VERIFIED_EIP1193_ONLY', canonicalWalletAuthorization: 'SOURCE_VERIFIED_REQUEST_BOUND_ONLY', productSession: 'SOURCE_VERIFIED_WEB_READ_ONLY_MOBILE_PENDING', historicalMobileProductSession: 'PENDING_AND_NOT_CALLED', browserIdentity: 'EXACT_BOUNDED_SAME_ORIGIN_IDENTITY_ONLY', installedWalletSuccess: 'NOT_ASSERTED_BY_THIS_VERIFIER', publicBusinessSuccess: false },
  releaseStates: release.releaseStates,
};
if (apkPath) {
  const apk = await readFile(apkPath);
  const artifact = { path: apkPath, bytes: apk.byteLength, sha256: sha256(apk), classification: 'LOCAL_TESTNET_CANDIDATE_ONLY' };
  assert(release.artifact?.android?.sha256 === artifact.sha256, 'release metadata APK hash does not match the verified artifact');
  report.artifact = artifact;
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
