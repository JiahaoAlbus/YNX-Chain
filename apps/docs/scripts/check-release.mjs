import {readFile} from 'node:fs/promises';

const repo = new URL('../../../', import.meta.url);
const readJSON = async (path) => JSON.parse(await readFile(new URL(path, repo), 'utf8'));

const [coverage, contract, vectors, release, publicMetadata] = await Promise.all([
  readJSON('.ai-bridge/full-goal-coverage.json'),
  readJSON('release/integration/docs-contract.json'),
  readJSON('docs/integration/CROSS_PRODUCT_TEST_VECTORS.json'),
  readJSON('product-release.json'),
  readJSON('public-product-metadata.json'),
]);

const commit = release.sourceCommit;
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('product release source commit must be a full SHA');
for (const [name, value] of Object.entries({coverage: coverage.sourceCommit, contract: contract.sourceCommit, vectors: vectors.sourceCommit, publicMetadata: publicMetadata.sourceCommit})) {
  if (value !== commit) throw new Error(`${name} source commit drift: ${value} != ${commit}`);
}

if (coverage.product !== 'YNX Docs' || coverage.status !== 'ACTIVE') throw new Error('coverage must identify active YNX Docs goal');
const allowed = new Set(coverage.allowedStatuses);
const required = ['id', 'category', 'requirement', 'applicability', 'status', 'evidence', 'sourceCommit', 'tests', 'artifact', 'publicProof', 'blockedBy', 'owner', 'nextAction', 'lastUpdated'];
const ids = new Set();
for (const item of coverage.items) {
  for (const key of required) if (!(key in item)) throw new Error(`coverage item ${item.id || '<unknown>'} missing ${key}`);
  if (ids.has(item.id)) throw new Error(`duplicate coverage id ${item.id}`);
  ids.add(item.id);
  if (!allowed.has(item.status)) throw new Error(`invalid status ${item.status} for ${item.id}`);
  if (!Array.isArray(item.evidence) || !Array.isArray(item.tests) || !Array.isArray(item.blockedBy)) throw new Error(`coverage arrays invalid for ${item.id}`);
  if (!item.owner || !item.nextAction) throw new Error(`coverage owner/nextAction missing for ${item.id}`);
  if (['testedLocal', 'integratedCentral', 'testnetVerified', 'publicVerified', 'verifiedComplete'].includes(item.status) && !item.sourceCommit) {
    throw new Error(`${item.id} claims ${item.status} without source commit`);
  }
}
if (coverage.items.length < 25) throw new Error('coverage matrix is unexpectedly narrow');

const releaseKeys = ['implementedLocal', 'testedLocal', 'installedLocal', 'integratedCentral', 'deployedStaging', 'deployedPublic', 'downloadHosted', 'productionSigned', 'storeReleased'];
for (const key of releaseKeys) {
  if (typeof release.releaseStatus[key] !== 'boolean') throw new Error(`release status ${key} must be boolean`);
  if (contract.releaseStatus[key] !== release.releaseStatus[key]) throw new Error(`contract/release status drift for ${key}`);
  if (publicMetadata.releaseStatus[key] !== release.releaseStatus[key]) throw new Error(`public/release status drift for ${key}`);
}
if (release.releaseStatus.deployedPublic || release.releaseStatus.downloadHosted || release.releaseStatus.productionSigned || release.releaseStatus.storeReleased) {
  throw new Error('public/signing/store flags require retained evidence and must remain false in this release record');
}
if (release.artifacts.length || publicMetadata.artifacts.length) throw new Error('artifact arrays must remain empty until retained hosted artifacts exist');
if (publicMetadata.website.websitePublished || publicMetadata.website.deployedPublic || publicMetadata.website.downloadHosted || publicMetadata.website.runtimePublicUrl) {
  throw new Error('public website/runtime metadata is not yet verified');
}

const publicText = JSON.stringify(publicMetadata).toLowerCase();
for (const forbidden of ['/users/', 'worktree', 'codex', 'branch', 'localhost', '127.0.0.1', '0.0.0.0']) {
  if (publicText.includes(forbidden)) throw new Error(`public metadata contains forbidden internal marker ${forbidden}`);
}

if (contract.contractId !== 'ynx-docs-v1' || contract.status !== 'candidateForCentralFreeze') throw new Error('integration contract identity/status invalid');
if (contract.walletBindings.web.requestingProduct !== 'docs' || contract.walletBindings.mobile.requestingProduct !== 'docs') throw new Error('Wallet product binding drift');
if (contract.exportModel.pdf !== 'not implemented or claimed') throw new Error('PDF must not be claimed without implementation evidence');
if (contract.trustEvidence.plaintextAllowed !== false) throw new Error('Trust evidence must reject document plaintext');

const vectorIds = new Set();
for (const vector of vectors.vectors) {
  if (!vector.id || vectorIds.has(vector.id)) throw new Error(`invalid or duplicate vector ${vector.id}`);
  vectorIds.add(vector.id);
  if (!Array.isArray(vector.owners) || vector.owners.length === 0 || !vector.expected || !Array.isArray(vector.localEvidence)) {
    throw new Error(`incomplete vector ${vector.id}`);
  }
}
if (vectors.vectors.length < 12) throw new Error('cross-product vectors are unexpectedly narrow');

console.log(`YNX Docs release truth checks passed: ${coverage.items.length} coverage items, ${vectors.vectors.length} test vectors, source ${commit.slice(0, 12)}`);
