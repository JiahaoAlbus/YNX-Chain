import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyFinanceWalletBundle} from '../web/verify-wallet-connect.mjs';

const financeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),webRoot=join(financeRoot,'web');
const reviewedManifest=JSON.parse(await readFile(join(webRoot,'wallet-verifier-manifest.json'),'utf8'));

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
  assert.equal(result.bytes,180425);
  assert.equal(result.sha256,'0e12ea5a77c0768411e1557ed946b63bfa744065b8e61c27ccbc7c8d18da9e14');
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
