import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import * as published from '@ynx-chain/wallet-auth/original-ide-admission';
import * as original from '../src/original-ide-admission-parent-delivery.js';

test('versioned Node entry exports the same existing production callers and custody',()=>{
  const names=['acquireOriginalIDEIdentityPeerBinding','acquireOriginalIDENativeAuthBinding','acquireOriginalIDEAdmissionParentDelivery','acquireOriginalIDEPrivateServiceChannel','getOriginalIDEPrivateServiceChannelCleanup','acquireOriginalIDEColdTerminalCustody','getOriginalIDEColdTerminalCustodyCleanup'].sort();
  assert.deepEqual(Object.keys(published).sort(),names);
  for(const name of names)assert.equal(published[name],original[name]);
});

test('public entry cannot become a browser or default-provider alternative',()=>{
  const child=spawnSync(process.execPath,['--conditions=browser','--input-type=module','-e',`try { await import('@ynx-chain/wallet-auth/original-ide-admission'); process.exit(1); } catch(e) { if(e.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED') throw e; }`],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
});

test('public import preserves unconfigured parent and cannot promote it into private service',async()=>{
  assert.equal(await published.acquireOriginalIDEAdmissionParentDelivery('file:///unconfigured/server.mjs'),null);
  await assert.rejects(published.acquireOriginalIDEPrivateServiceChannel('file:///unconfigured/server.mjs'),{code:'IDE_ORIGINAL_PRIVATE_PARENT_NOT_SUPPLIED'});
  assert.equal(published.getOriginalIDEPrivateServiceChannelCleanup('file:///unconfigured/server.mjs'),null);
  assert.equal(published.getOriginalIDEColdTerminalCustodyCleanup('file:///unconfigured/server.mjs'),null);
});
