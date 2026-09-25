import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyFinanceWalletBundle} from '../web/verify-wallet-connect.mjs';

const financeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),webRoot=join(financeRoot,'web');
const reviewedManifest=JSON.parse(await readFile(join(webRoot,'wallet-verifier-manifest.json'),'utf8'));

test('Broker cold-state pin changes only the reviewed app bytes',async()=>{
  const previous=JSON.parse(await readFile(join(financeRoot,'evidence/wallet-verifier-manifest-final-ui-01130b50-v5-20260925.json'),'utf8'));
  const versioned=await readFile(join(financeRoot,'evidence/wallet-verifier-manifest-broker-cold-state-32bacf14-v6-20260925.json'));
  const active=await readFile(join(webRoot,'wallet-verifier-manifest.json'));
  const app=execFileSync('git',['show','2e2b6c2255197ad62df9dcde88434c20e20846e9:apps/finance/web/app.js'],{cwd:resolve(financeRoot,'../..')});
  const expected=structuredClone(previous),entry=expected.files.find(file=>file.path==='app.js');
  entry.bytes=app.length;entry.sha256=createHash('sha256').update(app).digest('hex');
  assert.equal(entry.bytes,63629);
  assert.equal(entry.sha256,'c32c378b042b77fd5e54e9bd91306d3d4545d4c16b159b88b83610d9a268e80e');
  assert.deepEqual(JSON.parse(versioned),expected);
  assert.deepEqual(JSON.parse(versioned),expected);
  assert.notDeepEqual(active,versioned,'the historical v6 manifest must not be mistaken for the current source');
  assert.equal(createHash('sha256').update(active).digest('hex'),'0d8d7efc2d0a0bfa37003b724781916ff7c5969fb8b979088e73d8556868947d');
});

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'ynx-finance-wallet-verifier-test-')),web=join(root,'repo/apps/finance/web');
  const files=['wallet-verifier-manifest.json',...reviewedManifest.files.map(file=>file.path)];
  for(const relative of files){const target=resolve(web,relative);await mkdir(dirname(target),{recursive:true});await writeFile(target,await readFile(resolve(webRoot,relative)))}
  return {root,web,cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('current Finance Wallet files match the exact reviewed verifier manifest',async()=>{
  const result=await verifyFinanceWalletBundle({root:webRoot});
  assert.equal(result.status,'pass');
  assert.equal(result.entry,'wallet-auth-entry.js');
  assert.equal(result.bundle,'wallet-auth.js');
  assert.match(result.vendor,/^vendor\/standard-wallet-browser-[0-9a-f]{8}\.mjs$/u);
  assert.match(result.sha256,/^[0-9a-f]{64}$/u);
  assert.equal(result.sourceBundleReproducible,true);
  assert.equal(result.sourceBundleReproducibilityStatus,'VERIFIED_REPRODUCIBLE');
  assert.equal(result.cleanBuildCount,2);
  assert.equal(result.bytes,181663);
  assert.equal(result.sha256,'308714f5873469d528a49ce1df993fa9e3617ecabc60c7edaca7db063316893a');
});

test('missing current bundle fails closed',async()=>{
  const value=await fixture();
  try{await rm(join(value.web,'wallet-auth.js'));await assert.rejects(verifyFinanceWalletBundle({root:value.web}),error=>error.code==='FINANCE_WALLET_FILE_MISSING')}finally{await value.cleanup()}
});

test('legacy Wallet bundle is rejected before it can satisfy current integrity bindings',async()=>{
  const value=await fixture(),legacy=Buffer.from('launchWebAuthorization createStandardWalletConnectState wallet-connect-entry.js');
  try{await writeFile(join(value.web,'wallet-auth.js'),legacy);await assert.rejects(verifyFinanceWalletBundle({root:value.web}),error=>error.code==='FINANCE_WALLET_BUNDLE_LEGACY')}finally{await value.cleanup()}
});

test('tampered current bundle cannot match the reviewed manifest',async()=>{
  const value=await fixture(),expected=await readFile(join(value.web,'wallet-auth.js'));
  try{await writeFile(join(value.web,'wallet-auth.js'),Buffer.concat([expected,Buffer.from('\n/*tampered*/\n')]));await assert.rejects(verifyFinanceWalletBundle({root:value.web}),error=>error.code==='FINANCE_WALLET_FILE_INTEGRITY_MISMATCH')}finally{await value.cleanup()}
});

test('missing current SDK authority source fails closed before rebuild',async()=>{
  const value=await fixture();
  try{await rm(resolve(value.web,'../../../sdk/js/endpoint-authority-v2.js'));await assert.rejects(verifyFinanceWalletBundle({root:value.web}),error=>error.code==='FINANCE_WALLET_FILE_MISSING')}finally{await value.cleanup()}
});

test('coordinated bundle and verifier-manifest tampering cannot redefine the reviewed authority',async()=>{
  const value=await fixture(),bundlePath=join(value.web,'wallet-auth.js'),manifestPath=join(value.web,'wallet-verifier-manifest.json');
  try{
    const tampered=Buffer.concat([await readFile(bundlePath),Buffer.from('\n/*coordinated-tamper*/\n')]);await writeFile(bundlePath,tampered);
    const manifest=JSON.parse(await readFile(manifestPath,'utf8')),record=manifest.files.find(file=>file.path==='wallet-auth.js');
    record.bytes=tampered.byteLength;record.sha256=createHash('sha256').update(tampered).digest('hex');await writeFile(manifestPath,`${JSON.stringify(manifest,null,2)}\n`);
    await assert.rejects(verifyFinanceWalletBundle({root:value.web}),error=>error.code==='FINANCE_WALLET_VERIFIER_MANIFEST_INTEGRITY_MISMATCH');
  }finally{await value.cleanup()}
});

test('each reviewed file is read once so a second clean read cannot hide first-read tampering',async()=>{
  let bundleReads=0;
  const adversarialRead=async path=>{
    const bytes=await readFile(path);
    if(!path.endsWith('/wallet-auth.js'))return bytes;
    bundleReads+=1;
    return bundleReads===1?Buffer.concat([bytes,Buffer.from('\n/*unreviewed-first-read*/\n')]):bytes;
  };
  await assert.rejects(verifyFinanceWalletBundle({root:webRoot,readFile:adversarialRead}),error=>error.code==='FINANCE_WALLET_FILE_INTEGRITY_MISMATCH');
  assert.equal(bundleReads,1);
});

test('deterministic rebuild mismatch fails closed even when reviewed files match',async()=>{
  const value=await fixture();
  try{await assert.rejects(verifyFinanceWalletBundle({root:value.web,buildBundle:async()=>Buffer.from('not-the-reviewed-build')}),error=>error.code==='FINANCE_WALLET_REBUILD_MISMATCH')}finally{await value.cleanup()}
});

test('two different clean rebuilds fail closed before either can be accepted',async()=>{
  const value=await fixture();let builds=0;
  try{await assert.rejects(verifyFinanceWalletBundle({root:value.web,buildBundle:async()=>Buffer.from(`build-${++builds}`)}),error=>error.code==='FINANCE_WALLET_REBUILD_NONDETERMINISTIC');assert.equal(builds,2)}finally{await value.cleanup()}
});

test('reviewed source and bundle are read once before both rebuilds',async()=>{
  const reads=new Map();
  const singleRead=async path=>{reads.set(path,(reads.get(path)??0)+1);return readFile(path)};
  const result=await verifyFinanceWalletBundle({root:webRoot,readFile:singleRead});
  assert.equal(result.status,'pass');
  for(const relative of reviewedManifest.files.map(file=>file.path))assert.equal(reads.get(resolve(webRoot,relative)),1,relative);
});
