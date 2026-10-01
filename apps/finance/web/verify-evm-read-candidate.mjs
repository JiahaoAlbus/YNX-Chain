import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const candidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-workspace-2627b209-v5-20260925.json';
const guoqingCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-15a9aebc-20260930.json';
const transportCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-be66f758-20260930.json';
const journeyCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-2160807a-20260930.json';
const intentCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-cdaedfad-20260930.json';
const clockCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-82314ab0-20260930.json';
const ssoCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-sso-48309f3a-20261001.json';
const pairCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-pair-9220dbcb-20261001.json';
const cliCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-cli-d4b37236-20261001.json';
const recordsCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-records-b90b3348-20261001.json';
const recoveryCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-recovery-5e465a8e-20261001.json';
const rejectionCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-recovery-d64f5206-20261001.json';
const hostedCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-hosted-012e1ff68-20261001.json';
const hostedNativeCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-guoqing-hosted-native-d334806c-20261001.json';
const explicitSSOCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-explicit-sso-3d2fe39c-20261001.json';
const paperRegistryCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-paper-registry-7c4f46ef-20261001.json';
const confirmedRevokeCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-confirmed-revoke-99b6a91f-20261001.json';
const coldSSOCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-cold-sso-fb238441-20261001.json';
const hostedDemandCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-hosted-resume-52cce2ef-final-20261001.json';
const historyCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-authority-history-25c6dea55-20261001.json';
const mobileCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-mobile-cbaf6efa-20261001.json';
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

export async function verifyEVMReadCandidate({ root = repoRoot, read = readFile, pinnedCandidateSha256, candidatePath: reviewedCandidatePath = candidatePath } = {}) {
  if (!/^[0-9a-f]{64}$/u.test(pinnedCandidateSha256 || '')) fail('CANDIDATE_PIN_REQUIRED');
  if (![candidatePath,guoqingCandidatePath,transportCandidatePath,journeyCandidatePath,intentCandidatePath,clockCandidatePath,ssoCandidatePath,pairCandidatePath,cliCandidatePath,recordsCandidatePath,recoveryCandidatePath,rejectionCandidatePath,hostedCandidatePath,hostedNativeCandidatePath,explicitSSOCandidatePath,paperRegistryCandidatePath,confirmedRevokeCandidatePath,coldSSOCandidatePath,mobileCandidatePath,hostedDemandCandidatePath,historyCandidatePath].includes(reviewedCandidatePath)) fail('CANDIDATE_PATH_UNREVIEWED');
  const snapshot = new Map();
  const get = async path => {
    if (!snapshot.has(path)) snapshot.set(path, Buffer.from(await read(resolve(root, path))));
    return snapshot.get(path);
  };
  const candidateBytes = await get(reviewedCandidatePath);
  if (sha256(candidateBytes) !== pinnedCandidateSha256) fail('CANDIDATE_TAMPERED');
  let candidate;
  try { candidate = JSON.parse(candidateBytes); } catch { fail('CANDIDATE_INVALID'); }
  if (candidate.schemaVersion !== 'ynx.finance.evm-read-runtime-verifier-candidate.v1' ||
      candidate.status !== 'INDEPENDENT_REVIEW_REQUIRED_NOT_PINNED_NOT_PUBLIC' ||
      candidate.truth?.deployedPublic !== false || candidate.truth?.privateFinanceAuthorized !== false ||
      candidate.truth?.realWalletApproval !== false || candidate.truth?.orderOrTransactionAuthorized !== false ||
      candidate.existingVerifierPin?.pinChanged !== false) fail('CANDIDATE_AUTHORITY_DRIFT');
  const currentShape=[guoqingCandidatePath,transportCandidatePath,journeyCandidatePath,intentCandidatePath,clockCandidatePath,ssoCandidatePath,pairCandidatePath,cliCandidatePath,recordsCandidatePath,recoveryCandidatePath,rejectionCandidatePath,hostedCandidatePath,hostedNativeCandidatePath,explicitSSOCandidatePath,paperRegistryCandidatePath,confirmedRevokeCandidatePath,coldSSOCandidatePath,mobileCandidatePath,hostedDemandCandidatePath,historyCandidatePath].includes(reviewedCandidatePath);
  const inputs=currentShape?[...expectedInputs,'apps/finance/web/app.js','apps/finance/web/finance-locale.js']:expectedInputs;
  if([ssoCandidatePath,pairCandidatePath,cliCandidatePath,recordsCandidatePath,recoveryCandidatePath,rejectionCandidatePath,hostedCandidatePath,hostedNativeCandidatePath,explicitSSOCandidatePath,paperRegistryCandidatePath,confirmedRevokeCandidatePath,coldSSOCandidatePath,mobileCandidatePath,hostedDemandCandidatePath,historyCandidatePath].includes(reviewedCandidatePath))inputs.push('packages/wallet-auth/product-session-registry.json','packages/wallet-auth/src/central-browser-session-contract.js','packages/wallet-auth/src/central-browser-session-registry.js','packages/wallet-auth/src/central-browser-session-store.js','packages/wallet-auth/src/central-browser-session.js','packages/wallet-auth/src/central-browser-session-browser.js','packages/wallet-auth/src/central-browser-session-browser.bundle.js','packages/wallet-auth/src/product-session-gateway-node-host.js','packages/wallet-auth/scripts/ynx-wallet-gatewayd.mjs','internal/finance/browser_sso.go','internal/finance/browser_sso_binding.go','internal/finance/store.go','internal/finance/types.go','apps/finance/cmd/server/main.go');
  if([pairCandidatePath,cliCandidatePath,recordsCandidatePath,recoveryCandidatePath,rejectionCandidatePath,hostedCandidatePath,hostedNativeCandidatePath,explicitSSOCandidatePath,paperRegistryCandidatePath,confirmedRevokeCandidatePath,coldSSOCandidatePath,mobileCandidatePath,hostedDemandCandidatePath,historyCandidatePath].includes(reviewedCandidatePath))inputs.push('packages/wallet-auth/src/walletconnect-dapp-connection.js');
  if([hostedCandidatePath,hostedNativeCandidatePath,explicitSSOCandidatePath,paperRegistryCandidatePath,confirmedRevokeCandidatePath,coldSSOCandidatePath,mobileCandidatePath,hostedDemandCandidatePath,historyCandidatePath].includes(reviewedCandidatePath))inputs.push('packages/wallet-auth/src/vendor/hosted-wallet-adapter-39c063da.js');
  if([hostedNativeCandidatePath,explicitSSOCandidatePath,paperRegistryCandidatePath,confirmedRevokeCandidatePath,coldSSOCandidatePath,mobileCandidatePath,hostedDemandCandidatePath,historyCandidatePath].includes(reviewedCandidatePath))inputs.push('packages/wallet-auth/src/vendor/hosted-wallet-adapter-4bccefef.js');
  if (JSON.stringify(candidate.exactInputs?.map(item => item.path)) !== JSON.stringify(inputs)) fail('INPUT_SET_DRIFT');
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
  const scriptPattern=currentShape?/<script src="\/evm-read-session\.js\?v=[0-9a-f]{64}" defer><\/script>/gu:/<script src="\/evm-read-session\.js" defer><\/script>/gu;
  if ((html.match(scriptPattern) || []).length !== 1 ||
      !runtime.includes("'evm-read-session.js'") ||
      !runtime.includes("authority-runtime/apps/finance/scripts/evm-read-session-authority.bundle.mjs") ||
      !server.includes('GET /evm-read-session.js') || !server.includes('"/evm-read-session.js": "evm-read-session.js"') ||
      !drain.includes('"/evm-read-session.js"')) fail('RUNTIME_CLOSURE_DRIFT');
  if(currentShape)for(const name of ['app.js','finance-locale.js','evm-read-session.js']){
    const expected=`/${name}?v=${sha256(await get(`apps/finance/web/${name}`))}`;
    if(!html.includes(`src="${expected}"`))fail(`ASSET_CACHE_BINDING_DRIFT:${name}`);
  }

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
      if (path !== entry && !([ssoCandidatePath,pairCandidatePath,cliCandidatePath,recordsCandidatePath,recoveryCandidatePath,rejectionCandidatePath,hostedCandidatePath,hostedNativeCandidatePath,explicitSSOCandidatePath,paperRegistryCandidatePath,confirmedRevokeCandidatePath,coldSSOCandidatePath,mobileCandidatePath,hostedDemandCandidatePath,historyCandidatePath].includes(reviewedCandidatePath)&&path==='packages/wallet-auth/product-session-registry.json') && !path.startsWith('packages/wallet-auth/src/') && !path.startsWith('packages/wallet-auth/node_modules/@noble/')) fail('TRANSITIVE_PATH_DRIFT');
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
  if([pairCandidatePath,cliCandidatePath,recordsCandidatePath,recoveryCandidatePath,rejectionCandidatePath,hostedCandidatePath,hostedNativeCandidatePath,explicitSSOCandidatePath,paperRegistryCandidatePath,confirmedRevokeCandidatePath,coldSSOCandidatePath,mobileCandidatePath,hostedDemandCandidatePath,historyCandidatePath].includes(reviewedCandidatePath)){
    const relation=candidate.centralPairBundle,entry='packages/wallet-auth/src/central-browser-session-browser.js',bundle='packages/wallet-auth/src/central-browser-session-browser.bundle.js';
    if(relation?.entry!==entry||relation.bundle!==bundle||relation.tool!=='esbuild@0.25.9'||relation.independentRebuilds!==2)fail('CENTRAL_PAIR_RELATION_DRIFT');
    for(const [name,version] of [['@walletconnect/sign-client','2.23.10'],['qrcode','1.5.4']]){
      const dependency=lock.packages?.[`node_modules/${name}`];if(dependency?.version!==version||!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(dependency.integrity||''))fail('CENTRAL_PAIR_LOCK_DRIFT');
    }
    const base=resolve(root,'packages/wallet-auth'),options={absWorkingDir:base,entryPoints:['src/central-browser-session-browser.js'],bundle:true,platform:'browser',format:'iife',legalComments:'none',write:false,metafile:true};
    const discovered=await build(options),paths=Object.keys(discovered.metafile.inputs).map(path=>([hostedDemandCandidatePath,historyCandidatePath].includes(reviewedCandidatePath))?relative(root,resolve(base,path)).replaceAll('\\','/'):`packages/wallet-auth/${path}`).sort(),graph=new Map();
    if(JSON.stringify(paths)!==JSON.stringify(relation.dependencyGraphPaths))fail('CENTRAL_PAIR_GRAPH_PATH_DRIFT');
    for(const path of paths){
      if(path.includes('..')||path.includes('\\'))fail('CENTRAL_PAIR_IMPORT_INVALID');
      const hostedInput=([hostedDemandCandidatePath,historyCandidatePath].includes(reviewedCandidatePath))&&['apps/wallet-web/src/extension-chain-params.js','apps/wallet-web/src/hosted-adapter.js','apps/wallet-web/src/hosted-protocol.js','apps/wallet-web/vendor/product-session-registry-123016847.json'].includes(path);
      if(!hostedInput&&path!=='packages/wallet-auth/product-session-registry.json'&&!path.startsWith('packages/wallet-auth/src/')){
        const name=/^packages\/wallet-auth\/node_modules\/((?:@[^/]+\/)?[^/]+)\//u.exec(path)?.[1],dependency=lock.packages?.[`node_modules/${name}`];
        if(!name||!dependency?.version||!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(dependency.integrity||''))fail('CENTRAL_PAIR_UNLOCKED_IMPORT');
      }
      graph.set(resolve(root,path),await get(path));
    }
    if(sha256(paths.map(path=>`${path}\0${sha256(graph.get(resolve(root,path)))}\n`).join(''))!==relation.dependencyGraphSha256)fail('CENTRAL_PAIR_GRAPH_DRIFT');
    const plugin={name:'central-pair-reviewed-snapshot',setup(resolver){resolver.onLoad({filter:/.*/},args=>{const bytes=graph.get(resolve(args.path));if(!bytes)fail('CENTRAL_PAIR_UNREVIEWED_IMPORT');return {contents:bytes,loader:args.path.endsWith('.json')?'json':'js'};});}};
    const [first,second]=await Promise.all([build({...options,plugins:[plugin]}),build({...options,plugins:[plugin]})]),frozen=await get(bundle);
    if(!Buffer.from(first.outputFiles[0].contents).equals(frozen)||!Buffer.from(second.outputFiles[0].contents).equals(frozen)||frozen.length!==relation.bytes||sha256(frozen)!==relation.sha256)fail('CENTRAL_PAIR_BUNDLE_DRIFT');
  }
  return Object.freeze({ status: 'pass', reviewedCandidateSha256: pinnedCandidateSha256, bundleCount: [pairCandidatePath,cliCandidatePath,recordsCandidatePath,recoveryCandidatePath,rejectionCandidatePath,hostedCandidatePath,hostedNativeCandidatePath,explicitSSOCandidatePath,paperRegistryCandidatePath,confirmedRevokeCandidatePath,coldSSOCandidatePath,mobileCandidatePath,hostedDemandCandidatePath,historyCandidatePath].includes(reviewedCandidatePath)?3:2, publicRuntimeVerified: false });
}
