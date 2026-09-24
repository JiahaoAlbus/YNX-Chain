import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const candidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-pr199-v2-20260925.json';
const expectedInputs = Object.freeze([
  'apps/finance/package.json', 'apps/finance/package-lock.json',
  'apps/finance/web/package.json', 'apps/finance/web/package-lock.json',
  'apps/finance/web/index.html', 'apps/finance/web/evm-read-session.js',
  'apps/finance/scripts/evm-read-browser-entry.mjs',
  'apps/finance/scripts/evm-read-session-authority.mjs',
  'apps/finance/scripts/evm-read-session-authority.bundle.mjs',
  'apps/finance/scripts/finance-nonregressive-runtime.mjs',
  'internal/finance/server.go', 'internal/finance/drain.go',
  'packages/wallet-auth/package.json', 'packages/wallet-auth/package-lock.json',
  'packages/wallet-auth/src/index.js', 'packages/wallet-auth/src/evm-product-session.js',
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(`FINANCE_EVM_READ_${code}`); };

export async function verifyEVMReadCandidate({ root = repoRoot, read = readFile, pinnedCandidateSha256 } = {}) {
  if (!/^[0-9a-f]{64}$/u.test(pinnedCandidateSha256 || '')) fail('CANDIDATE_PIN_REQUIRED');
  const snapshot = new Map();
  const get = async path => {
    if (!snapshot.has(path)) snapshot.set(path, Buffer.from(await read(resolve(root, path))));
    return snapshot.get(path);
  };
  const candidateBytes = await get(candidatePath);
  if (sha256(candidateBytes) !== pinnedCandidateSha256) fail('CANDIDATE_TAMPERED');
  let candidate;
  try { candidate = JSON.parse(candidateBytes); } catch { fail('CANDIDATE_INVALID'); }
  if (candidate.schemaVersion !== 'ynx.finance.evm-read-runtime-verifier-candidate.v1' ||
      candidate.status !== 'INDEPENDENT_REVIEW_REQUIRED_NOT_PINNED_NOT_PUBLIC' ||
      candidate.truth?.deployedPublic !== false || candidate.truth?.privateFinanceAuthorized !== false ||
      candidate.truth?.realWalletApproval !== false || candidate.truth?.orderOrTransactionAuthorized !== false ||
      candidate.existingVerifierPin?.pinChanged !== false) fail('CANDIDATE_AUTHORITY_DRIFT');
  if (JSON.stringify(candidate.exactInputs?.map(item => item.path)) !== JSON.stringify(expectedInputs)) fail('INPUT_SET_DRIFT');
  for (const item of candidate.exactInputs) {
    if (!Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !/^[0-9a-f]{64}$/u.test(item.sha256)) fail('INPUT_IDENTITY_INVALID');
    const bytes = await get(item.path);
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) fail(`INPUT_TAMPERED:${item.path}`);
  }
  const lock = JSON.parse(await get('packages/wallet-auth/package-lock.json'));
  for (const name of ['@noble/curves', '@noble/hashes']) {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (entry?.version !== '2.2.0' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity || '')) fail('LOCKED_DEPENDENCY_MISSING');
  }
  if (esbuildVersion !== '0.25.9' || !Array.isArray(candidate.sourceBundleRelations) || candidate.sourceBundleRelations.length !== 2) fail('BUILD_CONTRACT_DRIFT');
  const html = (await get('apps/finance/web/index.html')).toString('utf8');
  const runtime = (await get('apps/finance/scripts/finance-nonregressive-runtime.mjs')).toString('utf8');
  const server = (await get('internal/finance/server.go')).toString('utf8');
  const drain = (await get('internal/finance/drain.go')).toString('utf8');
  if ((html.match(/<script src="\/evm-read-session\.js" defer><\/script>/gu) || []).length !== 1 ||
      !runtime.includes("'evm-read-session.js'") ||
      !runtime.includes("authority-runtime/apps/finance/scripts/evm-read-session-authority.bundle.mjs") ||
      !server.includes('GET /evm-read-session.js') || !server.includes('"/evm-read-session.js": "evm-read-session.js"') ||
      !drain.includes('"/evm-read-session.js"')) fail('RUNTIME_CLOSURE_DRIFT');

  for (const [index, kind, entry, bundle, options] of [
    [0, 'browser', 'apps/finance/scripts/evm-read-browser-entry.mjs', 'apps/finance/web/evm-read-session.js', { bundle: true, minify: true, platform: 'browser', target: 'es2022' }],
    [1, 'node', 'apps/finance/scripts/evm-read-session-authority.mjs', 'apps/finance/scripts/evm-read-session-authority.bundle.mjs', { bundle: true, platform: 'node', target: 'node22', format: 'esm' }],
  ]) {
    const relation = candidate.sourceBundleRelations[index];
    if (relation?.kind !== kind || relation.entry !== entry || relation.bundle !== bundle || relation.tool !== 'esbuild@0.25.9' || relation.independentRebuilds !== 2) fail('SOURCE_RELATION_DRIFT');
    const buildOptions = { absWorkingDir: root, entryPoints: [resolve(root, entry)], write: false, metafile: true, ...options };
    const discovered = await build(buildOptions);
    const paths = Object.keys(discovered.metafile.inputs).sort();
    const graph = new Map();
    for (const path of paths) {
      if (path !== entry && !path.startsWith('packages/wallet-auth/src/') && !path.startsWith('packages/wallet-auth/node_modules/@noble/')) fail('TRANSITIVE_PATH_DRIFT');
      graph.set(resolve(root, path), await get(path));
    }
    const graphDigest = sha256(paths.map(path => `${path}\0${sha256(graph.get(resolve(root, path)))}\n`).join(''));
    if (paths.length !== relation.dependencyGraphInputs ||
        paths.filter(path => !path.includes('/node_modules/')).length !== relation.repositoryGraphInputs ||
        paths.filter(path => path.includes('/node_modules/')).length !== relation.lockedDependencyGraphInputs ||
        graphDigest !== relation.dependencyGraphSha256) fail('TRANSITIVE_GRAPH_DRIFT');
    const plugin = { name: 'finance-evm-reviewed-snapshot', setup(resolver) {
      resolver.onLoad({ filter: /.*/ }, args => {
        const bytes = graph.get(resolve(args.path));
        if (!bytes) fail('UNREVIEWED_IMPORT');
        return { contents: bytes, loader: args.path.endsWith('.json') ? 'json' : 'js' };
      });
    } };
    const [first, second] = await Promise.all([
      build({ ...buildOptions, plugins: [plugin] }),
      build({ ...buildOptions, plugins: [plugin] }),
    ]);
    const frozen = await get(bundle);
    if (first.outputFiles.length !== 1 || second.outputFiles.length !== 1 ||
        !Buffer.from(first.outputFiles[0].contents).equals(frozen) ||
        !Buffer.from(second.outputFiles[0].contents).equals(frozen) ||
        frozen.length !== relation.bundleBytes || sha256(frozen) !== relation.bundleSha256) fail('BUNDLE_REBUILD_MISMATCH');
  }
  return Object.freeze({ status: 'pass', reviewedCandidateSha256: pinnedCandidateSha256, bundleCount: 2, publicRuntimeVerified: false });
}
