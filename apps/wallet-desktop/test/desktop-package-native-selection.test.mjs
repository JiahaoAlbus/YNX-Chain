// Reuse supplier PUBLIC refusal controls in the normal test/*.test.mjs CI entry.
import '../scripts/test/wallet-control-matched-normal-component-public.test.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {desktopPackageNativeComponent,desktopPackageNativeOptions,desktopPackageNativeIdentityComponent} from '../scripts/desktop-package-native-selection.mjs';
import {DESKTOP_WALLET_CONTROL_MATCHED_METADATA_ROLE} from '../scripts/desktop-wallet-control-matched-pack.mjs';
import {DESKTOP_C6_METADATA_ROLE} from '../scripts/desktop-native49-c6-pack.mjs';
test('new explicit package identity selects its independent image and record, old C6 remains exact',()=>{
 const old=desktopPackageNativeComponent({ynxNativeComponent:DESKTOP_C6_METADATA_ROLE}),matched=desktopPackageNativeComponent({ynxNativeComponent:DESKTOP_WALLET_CONTROL_MATCHED_METADATA_ROLE});
 assert.equal(old.matched,false);assert.equal(matched.matched,true);assert.notEqual(old.selection.recordRelative,matched.selection.recordRelative);assert.notDeepEqual(old.selection.sourceRoles,matched.selection.sourceRoles);
 assert.deepEqual(desktopPackageNativeOptions({ynxNativeComponent:DESKTOP_C6_METADATA_ROLE}),{native49C6:true,walletControlMatched:false});assert.deepEqual(desktopPackageNativeOptions({ynxNativeComponent:DESKTOP_WALLET_CONTROL_MATCHED_METADATA_ROLE}),{native49C6:false,walletControlMatched:true});
});
test('unselected and unknown metadata cannot silently select a new image',()=>{assert.equal(desktopPackageNativeComponent({}),null);assert.deepEqual(desktopPackageNativeOptions({}),{native49C6:false,walletControlMatched:false});assert.throws(()=>desktopPackageNativeComponent({ynxNativeComponent:'unknown'}));});
test('runtime identity rejects changed record, missing asset and cross-family source role',()=>{
 const old=desktopPackageNativeComponent({ynxNativeComponent:DESKTOP_C6_METADATA_ROLE}),matched=desktopPackageNativeComponent({ynxNativeComponent:DESKTOP_WALLET_CONTROL_MATCHED_METADATA_ROLE});assert.equal(desktopPackageNativeIdentityComponent(structuredClone(matched.selection)),matched);
 for(const mutate of [s=>s.recordRelative=old.selection.recordRelative,s=>s.assets.pop(),s=>s.sourceRoles=old.selection.sourceRoles]){const value=structuredClone(matched.selection);mutate(value);assert.throws(()=>desktopPackageNativeIdentityComponent(value),/SEPARATE_NATIVE_RUNTIME_SELECTION_DIFFERS/);}
});
