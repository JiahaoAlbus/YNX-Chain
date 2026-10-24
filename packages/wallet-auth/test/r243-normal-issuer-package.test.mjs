import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const pkgRoot=fileURLToPath(new URL('../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
test('R243 SDK normal issuer bin and exact supplier Native input are selected without activation',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(pkgRoot,'package.json'))),lock=JSON.parse(fs.readFileSync(path.join(pkgRoot,'package-lock.json'))),inventory=JSON.parse(fs.readFileSync(path.join(pkgRoot,'integration/SDK332_R140_NATIVE_COMPATIBILITY.json')));
 assert.equal(pkg.version,'1.3.0-pq.3.32-auth.38');assert.equal(lock.version,pkg.version);assert.equal(inventory.version,pkg.version);
 assert.equal(pkg.bin['ynx-auth-source-issue'],'scripts/ynx-auth-source-issue.mjs');assert.equal(lock.packages[''].bin['ynx-auth-source-issue'],pkg.bin['ynx-auth-source-issue']);
 const raw=fs.readFileSync(path.join(pkgRoot,'native/original-auth-identity-source-v2-verifier.mjs')),pin=inventory.NativeInputs.find(r=>r.path==='packages/wallet-auth/native/original-auth-identity-source-v2-verifier.mjs');
 assert.equal(pin.bytes,raw.length);assert.equal(pin.sha256,sha(raw));assert.equal(inventory.NativeInputs.length,99);
 for(const field of ['publicGenericSigner','normalHTTPMutation','realRoleSupplied','independentApprovalSupplied','SourceQualified','installed'])assert.equal(inventory.supplierR243[field],false);
});
test('R243 actual packed normal issuer denies unconfigured release before private custody and public output',()=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-r243-packed-')));
 try{
  const npm=spawnSync('npm',['pack','--ignore-scripts','--json','--pack-destination',dir],{cwd:pkgRoot,encoding:'utf8',timeout:30000,maxBuffer:2<<20});assert.equal(npm.status,0,npm.stderr);
  const packed=JSON.parse(npm.stdout)[0];assert.equal(packed.files.length,341);for(const file of packed.files)assert(!file.path.startsWith('/')&&!file.path.split('/').includes('..'));
  for(const name of ['src/original-auth-source-issuance-v2.js','scripts/ynx-auth-source-issue.mjs'])assert(packed.files.some(f=>f.path===name));
  const tar=spawnSync('/usr/bin/tar',['-xzf',path.join(dir,packed.filename),'-C',dir],{encoding:'utf8',timeout:10000,maxBuffer:1<<20});assert.equal(tar.status,0,tar.stderr);
  const extracted=path.join(dir,'package');fs.symlinkSync(fs.realpathSync(path.join(pkgRoot,'node_modules')),path.join(extracted,'node_modules'),'dir');
  const run=spawnSync(process.execPath,[path.join(extracted,'scripts/ynx-auth-source-issue.mjs')],{cwd:extracted,encoding:'utf8',timeout:10000,maxBuffer:1<<20});
  assert.equal(run.status,1);assert.equal(run.stdout,'');assert.match(run.stderr,/AUTH_ISSUANCE_RELEASE_NOT_CONFIGURED/);assert.doesNotMatch(run.stderr,/MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
