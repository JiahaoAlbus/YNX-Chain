import test from 'node:test';import assert from 'node:assert/strict';
import {canonicalNativeSourcesForOwner} from './package-identity-admission-source.mjs';
test('SDK-supplied developer helper is read from its frozen supplier, not the IDE checkout',()=>{
 const helper={path:'apps/developer/helper/main.mm',sourceOwner:'sdk'},supplier={path:'apps/developer/desktop/macos/original-ide-parent-supplier.mm',sourceOwner:'ide'},core={path:'packages/wallet-auth/native/original-auth-identity-source-authority.mm',sourceOwner:'sdk'},input={nativeSources:[helper,supplier,core]};
 assert.deepEqual(canonicalNativeSourcesForOwner(input,'ide'),[supplier]);assert.deepEqual(canonicalNativeSourcesForOwner(input,'sdk'),[helper,core]);
 assert.throws(()=>canonicalNativeSourcesForOwner({nativeSources:[{...helper,sourceOwner:'ambient'}]},'sdk'),/owner differs/);
});
test('historical sealed Native inventories retain their original ownership without changing source bytes',()=>{const ide={path:'apps/developer/desktop/macos/original-ide-parent-supplier.h'},sdk={path:'packages/wallet-auth/native/original-ide-parent-kernel.h'};const input={nativeSources:[ide,sdk]};assert.deepEqual(canonicalNativeSourcesForOwner(input,'ide'),[ide]);assert.deepEqual(canonicalNativeSourcesForOwner(input,'sdk'),[sdk]);assert.equal(Object.hasOwn(ide,'sourceOwner'),false);});
