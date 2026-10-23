import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const nodeUnits=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version.match(/^1\.3\.0-pq\.3\.32-auth\.(12|13|14|15)$/)!==null?13:12;
import * as builder from '../../../apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs';
test('normal Node and helper each compile the actual typed publication implementation exactly once',()=>{
 const node=builder.originalAuthNativeBuildPlan('arm64','/original/pinned/headers'),helper=builder.originalIDEHelperBuildPlan('arm64');
 assert.equal(node.sources.length,nodeUnits);assert.equal(helper.sources.length,11);
 for(const plan of [node,helper]){
  assert.equal(plan.sources.filter(p=>p.endsWith('/original-ide-publication-artifact.mm')).length,1);
  assert.deepEqual(plan.ownedUndefinedScan,{tool:'/usr/bin/nm',argv:['-u',plan.output],rejectPattern:'YNX|ynx'});
 }
});
test('normal post-link guard rejects an unresolved own publication parser even with NAPI dynamic lookup',()=>{
 assert.equal(typeof builder.assertOriginalAuthOwnedSymbols,'function');
 for(const name of ['_YNXParseOriginalIDEPublicationManifest','_OBJC_CLASS_$_YNXOriginalIDEPublicationArtifact','__ZN3YNX6memberEv'])assert.throws(()=>builder.assertOriginalAuthOwnedSymbols(name),/OWNED_SYMBOL_UNRESOLVED/);
 assert.doesNotThrow(()=>builder.assertOriginalAuthOwnedSymbols('                 U _napi_create_object\n                 U _objc_msgSend'));
});
test('owned scan reads actual symbol rows without rejecting universal binary filename headings',()=>{
 assert.doesNotThrow(()=>builder.assertOriginalAuthOwnedSymbols('/original/YNX Chain/YNXIdentityReceiver (for architecture arm64):\n_napi_create_object\n_objc_msgSend\n'));
 assert.throws(()=>builder.assertOriginalAuthOwnedSymbols('/original/YNX Chain/output (for architecture x86_64):\n_YNXParseOriginalIDEPublicationManifest\n'),/OWNED_SYMBOL_UNRESOLVED/);
});
