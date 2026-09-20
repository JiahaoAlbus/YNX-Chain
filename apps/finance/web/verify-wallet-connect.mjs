import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const webRoot=dirname(fileURLToPath(import.meta.url));
const BUILD_COMMAND='esbuild wallet-auth-entry.js --bundle --minify --platform=browser --target=es2022 --outfile=wallet-auth.js';
const ENTRY='wallet-auth-entry.js',BUNDLE='wallet-auth.js';
const LEGACY_FILES=['wallet-connect-entry.js','wallet-connect.js'];
const VERIFIER_MANIFEST='wallet-verifier-manifest.json';
const REVIEWED_VERIFIER_MANIFEST_SHA256='32d9d9f13c6a486e08d2ffdef0b2b4cc87cb52e86c7a42f8d703c02f7b7f7f98';
const REVIEWED_FILES=['package.json','wallet-auth-entry.js','private-wallet-entry.js','wallet-auth.js','index.html','app.js','vendor/standard-wallet-browser-c97f85e9.mjs','../scripts/finance-nonregressive-runtime.mjs','../scripts/build-finance-weekly-v3-candidate.mjs'];

function fail(code,message){const error=new Error(`${code}: ${message}`);error.code=code;throw error}
function sha256(value){return createHash('sha256').update(value).digest('hex')}
async function mustRead(path,read){try{return await read(path)}catch(error){if(error?.code==='ENOENT')fail('FINANCE_WALLET_FILE_MISSING',`Required Wallet verifier input is missing: ${path}`);throw error}}

export async function verifyFinanceWalletBundle(options={}){
  const root=resolve(options.root??webRoot),read=options.readFile??readFile;
  const bindingBytes=await mustRead(join(root,VERIFIER_MANIFEST),read);
  if(sha256(bindingBytes)!==REVIEWED_VERIFIER_MANIFEST_SHA256)fail('FINANCE_WALLET_VERIFIER_MANIFEST_INTEGRITY_MISMATCH',`${VERIFIER_MANIFEST} is not the reviewed verifier authority`);
  let binding;try{binding=JSON.parse(bindingBytes.toString('utf8'))}catch{fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID',`${VERIFIER_MANIFEST} is not valid JSON`)}
  if(Object.keys(binding).sort().join(',')!=='build,files,schemaVersion,sourceBundleRelation'||binding.schemaVersion!=='ynx.finance.wallet-web-verifier.v1')fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID','unexpected verifier manifest schema');
  if(binding.build?.command!==BUILD_COMMAND||binding.build?.entry!==ENTRY||binding.build?.bundle!==BUNDLE||Object.keys(binding.build).sort().join(',')!=='bundle,command,entry')fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID','verifier build binding is invalid');
  if(binding.sourceBundleRelation?.byteReproducible!==false||binding.sourceBundleRelation?.status!=='NOT_VERIFIED_AS_REPRODUCIBLE'||!Number.isSafeInteger(binding.sourceBundleRelation?.observedRebuildBytes)||!/^[0-9a-f]{64}$/u.test(binding.sourceBundleRelation?.observedRebuildSha256??''))fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID','source/bundle reproducibility boundary is missing');
  if(!Array.isArray(binding.files)||binding.files.length!==9)fail('FINANCE_WALLET_VERIFIER_MANIFEST_INVALID','expected nine exact verifier inputs');
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
  return Object.freeze({status:'pass',entry:ENTRY,bundle:BUNDLE,vendor:`vendor/${vendorMatch[1]}`,sha256:committedHash,bytes:bundleBytes.byteLength,transport:'EIP-6963/EIP-1193 provider-only',sourceBundleReproducible:false,sourceBundleReproducibilityStatus:'NOT_VERIFIED_AS_REPRODUCIBLE',legacyFilesRejected:Object.freeze([...LEGACY_FILES])});
}

const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked)console.log(JSON.stringify(await verifyFinanceWalletBundle(),null,2));
