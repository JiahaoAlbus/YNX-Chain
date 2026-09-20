import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyFinanceWalletBundle} from '../web/verify-wallet-connect.mjs';

const financeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),webRoot=join(financeRoot,'web');
const fixtureFiles=[
  'web/package.json','web/wallet-auth-entry.js','web/wallet-auth.js','web/index.html','web/app.js','web/vendor/standard-wallet-browser-c97f85e9.mjs',
  'web/private-wallet-entry.js','web/wallet-verifier-manifest.json',
  'scripts/finance-nonregressive-runtime.mjs','scripts/build-finance-weekly-v3-candidate.mjs',
];

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'ynx-finance-wallet-verifier-test-'));
  for(const relative of fixtureFiles){const target=join(root,relative);await mkdir(dirname(target),{recursive:true});await writeFile(target,await readFile(join(financeRoot,relative)))}
  return {root,web:join(root,'web'),cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('current Finance Wallet files match the exact reviewed verifier manifest',async()=>{
  const result=await verifyFinanceWalletBundle({root:webRoot});
  assert.equal(result.status,'pass');
  assert.equal(result.entry,'wallet-auth-entry.js');
  assert.equal(result.bundle,'wallet-auth.js');
  assert.match(result.vendor,/^vendor\/standard-wallet-browser-[0-9a-f]{8}\.mjs$/u);
  assert.match(result.sha256,/^[0-9a-f]{64}$/u);
  assert.equal(result.sourceBundleReproducible,false);
  assert.equal(result.sourceBundleReproducibilityStatus,'NOT_VERIFIED_AS_REPRODUCIBLE');
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
