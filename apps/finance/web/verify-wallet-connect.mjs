import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {build as esbuild,version as esbuildVersion} from 'esbuild';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const webRoot=dirname(fileURLToPath(import.meta.url));
const BUILD_COMMAND='esbuild wallet-auth-entry.js --bundle --minify --platform=browser --target=es2022 --outfile=wallet-auth.js';
const ENTRY='wallet-auth-entry.js',BUNDLE='wallet-auth.js';
const LEGACY_FILES=['wallet-connect-entry.js','wallet-connect.js'];
const VERIFIER_MANIFEST='wallet-verifier-manifest.json';
const REVIEWED_VERIFIER_MANIFEST_SHA256='91c86deb4712d431ae7eb40e2752702919c45c435d76988784d781bd99c8f280';
const REVIEWED_FILES=['package.json','package-lock.json','wallet-auth-entry.js','private-wallet-entry.js','endpoint-authority-entry.js','endpoint-authority-store.js','order-wallet-entry.js','wallet-auth.js','order-wallet.js','index.html','app.js','vendor/standard-wallet-browser-c97f85e9.mjs','vendor/product-session-browser-a7dad7ec.mjs','vendor/product-session-registry-a7dad7ec.json','../mobile/contract/endpoint-authority-pin.json','../../../sdk/js/index.js','../../../sdk/js/endpoint-authority.js','../../../sdk/js/endpoint-authority-v2.js','../../../sdk/js/endpoint-authority-bundle.js','../../../sdk/js/testnet-endpoints.js','../../../sdk/js/ynx-testnet.js','../../../sdk/js/wallet.js','../scripts/finance-nonregressive-runtime.mjs','../scripts/build-finance-weekly-v3-candidate.mjs'];

function fail(code,message){const error=new Error(`${code}: ${message}`);error.code=code;throw error}
function sha256(value){return createHash('sha256').update(value).digest('hex')}
async function mustRead(path,read){try{return await read(path)}catch(error){if(error?.code==='ENOENT')fail('FINANCE_WALLET_FILE_MISSING',`Required Wallet verifier input is missing: ${path}`);throw error}}

async function buildSnapshot(root,contents){
  const byAbsolute=new Map([...contents].map(([path,bytes])=>[resolve(root,path),bytes]));
  const sdkEntry=resolve(root,'../../../sdk/js/index.js');
  const result=await esbuild({
    absWorkingDir:root,bundle:true,entryPoints:[resolve(root,ENTRY)],minify:true,platform:'browser',target:'es2022',write:false,
    plugins:[{name:'finance-reviewed-wallet-snapshot',setup(build){
      build.onResolve({filter:/.*/},args=>{
        const path=args.path==='@ynx-chain/sdk'?sdkEntry:args.kind==='entry-point'?resolve(args.path):resolve(dirname(args.importer),args.path);
        if(!byAbsolute.has(path))fail('FINANCE_WALLET_UNREVIEWED_BUILD_INPUT',`Build requested unreviewed input: ${path}`);
        return {path,namespace:'finance-reviewed-wallet'};
      });
      build.onLoad({filter:/.*/,namespace:'finance-reviewed-wallet'},args=>{
        const bytes=byAbsolute.get(args.path);
        if(!bytes)fail('FINANCE_WALLET_UNREVIEWED_BUILD_INPUT',`Build requested unavailable input: ${args.path}`);
        return {contents:bytes,loader:args.path.endsWith('.json')?'json':'js'};
      });
    }}],
  });
  if(result.outputFiles?.length!==1)fail('FINANCE_WALLET_REBUILD_INVALID','Reviewed Wallet build did not produce exactly one bundle');
  return Buffer.from(result.outputFiles[0].contents);
}

export async function verifyFinanceWalletBundle(options={}){
  const root=resolve(options.root??webRoot),read=options.readFile??readFile,rebuild=options.buildBundle??buildSnapshot;
  const bindingBytes=await mustRead(join(root,VERIFIER_MANIFEST),read);
  if(sha256(bindingBytes)!==REVIEWED_VERIFIER_MANIFEST_SHA256)fail('FINANCE_WALLET_VERIFIER_MANIFEST_INTEGRITY_MISMATCH',`${VERIFIER_MANIFEST} is not the reviewed verifier authority`);
  let binding;try{binding=JSON.parse(bindingBytes.toString('utf8'))}catch{fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID',`${VERIFIER_MANIFEST} is not valid JSON`)}
  if(Object.keys(binding).sort().join(',')!=='build,files,schemaVersion,sourceBundleRelation'||binding.schemaVersion!=='ynx.finance.wallet-web-verifier.v1')fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID','unexpected verifier manifest schema');
  if(binding.build?.command!==BUILD_COMMAND||binding.build?.entry!==ENTRY||binding.build?.bundle!==BUNDLE||binding.build?.esbuildVersion!=='0.25.9'||Object.keys(binding.build).sort().join(',')!=='bundle,command,entry,esbuildVersion')fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID','verifier build binding is invalid');
  if(binding.sourceBundleRelation?.byteReproducible!==true||binding.sourceBundleRelation?.status!=='VERIFIED_REPRODUCIBLE'||binding.sourceBundleRelation?.cleanBuildCount!==2||binding.sourceBundleRelation?.bytes!==179132||binding.sourceBundleRelation?.sha256!=='42c89560005eacc0bacae744fad7b3d8209908699a75066ddb8ce61b2936995c'||Object.keys(binding.sourceBundleRelation).sort().join(',')!=='byteReproducible,bytes,cleanBuildCount,sha256,status')fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID','source/bundle reproducibility binding is invalid');
  if(esbuildVersion!==binding.build.esbuildVersion)fail('FINANCE_WALLET_BUILD_TOOL_MISMATCH',`Expected esbuild ${binding.build.esbuildVersion}, got ${esbuildVersion}`);
  if(!Array.isArray(binding.files)||binding.files.length!==REVIEWED_FILES.length)fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID',`expected ${REVIEWED_FILES.length} exact verifier inputs`);
  if(JSON.stringify(binding.files.map(file=>file?.path))!==JSON.stringify(REVIEWED_FILES))fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID','verifier file set or order is not reviewed');
  const seen=new Set();
  const contents=new Map(await Promise.all(binding.files.map(async file=>{
    if(!file||Object.keys(file).sort().join(',')!=='bytes,path,sha256'||typeof file.path!=='string'||seen.has(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<1||!/^[0-9a-f]{64}$/u.test(file.sha256))fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID','invalid or duplicate verifier file binding');
    seen.add(file.path);const bytes=await mustRead(resolve(root,file.path),read);
    if(file.path===BUNDLE&&/launchWebAuthorization|wallet-connect-entry\.js|createStandardWalletConnectState|reduceStandardWalletConnectState/u.test(bytes.toString('utf8')))fail('FINANCE_WALLET_BUNDLE_LEGACY','committed Wallet bundle contains legacy launcher/state-machine code');
    if(bytes.byteLength!==file.bytes||sha256(bytes)!==file.sha256)fail('FINANCE_WALLET_FILE_INTEGRITY_MISMATCH',`${file.path} does not match the reviewed verifier manifest`);
    return [file.path,bytes];
  })));
  const manifestBytes=contents.get('package.json'),entryBytes=contents.get(ENTRY),bundleBytes=contents.get(BUNDLE),htmlBytes=contents.get('index.html'),appBytes=contents.get('app.js');
  const runtimeManifestBytes=contents.get('../scripts/finance-nonregressive-runtime.mjs'),candidateBuilderBytes=contents.get('../scripts/build-finance-weekly-v3-candidate.mjs');
  let manifest;try{manifest=JSON.parse(manifestBytes.toString('utf8'))}catch{fail('FINANCE_WALLET_MANIFEST_INVALID','web/package.json is not valid JSON')}
  if(manifest?.scripts?.['build:wallet']!==BUILD_COMMAND)fail('FINANCE_WALLET_MANIFEST_DRIFT','build:wallet no longer identifies the reviewed Wallet entry and bundle');

  const entry=entryBytes.toString('utf8'),bundle=bundleBytes.toString('utf8'),html=htmlBytes.toString('utf8'),app=appBytes.toString('utf8');
  const runtimeManifest=runtimeManifestBytes.toString('utf8'),candidateBuilder=candidateBuilderBytes.toString('utf8');
  const vendorMatch=entry.match(/from ['"]\.\/vendor\/(standard-wallet-browser-[0-9a-f]{8}\.mjs)['"]/u);
  if(!vendorMatch)fail('FINANCE_WALLET_ENTRY_INVALID','current entry does not bind one versioned Standard Wallet browser authority');
  const vendor=contents.get(`vendor/${vendorMatch[1]}`)?.toString('utf8');
  if(!vendor)fail('FINANCE_WALLET_AUTHORITY_INVALID','versioned Standard Wallet authority is not reviewed');

  for(const marker of ['StandardWalletConnection','discoverWalletProviders','privateFinance','wallet_switchEthereumChain','wallet_addEthereumChain','eth_chainId','0x1917','https://finance.ynxweb4.com'])if(!entry.includes(marker))fail('FINANCE_WALLET_ENTRY_INVALID',`current entry is missing ${marker}`);
  for(const marker of ['StandardWalletConnection','discoverWalletProviders','eth_accounts','eth_requestAccounts','eth_chainId','wallet_switchEthereumChain','wallet_addEthereumChain'])if(!vendor.includes(marker))fail('FINANCE_WALLET_AUTHORITY_INVALID',`versioned Standard Wallet authority is missing ${marker}`);
  for(const forbidden of [/ynxwallet:/u,/<iframe/iu,/window\.open\s*\(/u,/location\.(?:assign|replace)\s*\(/u,/location\.href\s*=/u])if(forbidden.test(entry))fail('FINANCE_WALLET_ENTRY_FORBIDDEN',`current entry contains forbidden transport ${forbidden}`);

  const walletScripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)].map(match=>match[1]).filter(source=>source.includes('wallet'));
  if(JSON.stringify(walletScripts)!==JSON.stringify(['/wallet-auth.js','/order-wallet.js']))fail('FINANCE_WALLET_HTML_BINDING_DRIFT',`unexpected Wallet scripts: ${walletScripts.join(',')||'none'}`);
  for(const marker of ['window.YNXFinanceWallet.getRevision()','window.YNXFinanceWallet.requireProof(','ynx-finance-standard-state','ynx-finance-private-state'])if(!app.includes(marker))fail('FINANCE_WALLET_CONSUMER_BINDING_DRIFT',`Finance app is missing ${marker}`);
  for(const name of [ENTRY,BUNDLE])if(!runtimeManifest.includes(`'${name}'`))fail('FINANCE_WALLET_RUNTIME_MANIFEST_DRIFT',`${name} is absent from the candidate runtime manifest`);
  for(const name of LEGACY_FILES){
    if(runtimeManifest.includes(`'${name}'`)||html.includes(name))fail('FINANCE_WALLET_LEGACY_REINTRODUCED',`${name} is bound by a current manifest`);
    if(!candidateBuilder.includes(`'${name}'`))fail('FINANCE_WALLET_CANDIDATE_GUARD_DRIFT',`${name} is no longer rejected by the candidate builder`);
  }
  const committedHash=sha256(bundleBytes);
  const firstBuild=await rebuild(root,contents),secondBuild=await rebuild(root,contents);
  if(!firstBuild.equals(secondBuild))fail('FINANCE_WALLET_REBUILD_NONDETERMINISTIC','Two clean Wallet rebuilds are not byte-identical');
  if(!firstBuild.equals(bundleBytes))fail('FINANCE_WALLET_REBUILD_MISMATCH','Committed Wallet bundle is not the exact reviewed-source build output');
  if(firstBuild.byteLength!==binding.sourceBundleRelation.bytes||sha256(firstBuild)!==binding.sourceBundleRelation.sha256)fail('FINANCE_WALLET_REBUILD_IDENTITY_MISMATCH','Wallet rebuild does not match its reviewed reproducibility identity');
  for(const marker of ['AUTHORITY_V2_CLOCK_REQUIRED','AUTHORITY_V2_ROOT_ROLLBACK'])if(!bundle.includes(marker))fail('FINANCE_WALLET_CURRENT_AUTHORITY_MISSING',`Wallet bundle omits current SDK authority marker ${marker}`);
  return Object.freeze({status:'pass',entry:ENTRY,bundle:BUNDLE,vendor:`vendor/${vendorMatch[1]}`,sha256:committedHash,bytes:bundleBytes.byteLength,transport:'EIP-6963/EIP-1193 provider-only',sourceBundleReproducible:true,sourceBundleReproducibilityStatus:'VERIFIED_REPRODUCIBLE',cleanBuildCount:2,legacyFilesRejected:Object.freeze([...LEGACY_FILES])});
}

const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked)console.log(JSON.stringify(await verifyFinanceWalletBundle(),null,2));
