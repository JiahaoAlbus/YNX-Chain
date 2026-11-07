import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {desktopNative49C6Selected,desktopNative49C6BuilderConfiguration,desktopNative49C6Selection as selection,verifyDesktopNative49C6Input} from '../scripts/desktop-native49-c6-pack.mjs';
const metadata=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
const require=createRequire(new URL('../package.json',import.meta.url));
const {FileMatcher}=require('app-builder-lib/out/fileMatcher');
test('explicit c6 builder selects exactly ten staged assets and no legacy Node/cache',()=>{
 const c=desktopNative49C6BuilderConfiguration(metadata),fileSet=c.files.at(-2);
 assert.equal(desktopNative49C6Selected(c.extraMetadata),true);
 const normal=new FileMatcher('/PUBLIC/project','/PUBLIC/out',x=>x,c.files.filter(x=>typeof x==='string')).createFilter();
 const stage=new FileMatcher('/PUBLIC/stage','/PUBLIC/out',x=>x,fileSet.filter).createFilter();
 const unpacked=new FileMatcher('/PUBLIC/stage','/PUBLIC/out',x=>x,c.asarUnpack).createFilter();
 const stat={isDirectory:()=>false};
 for(const row of selection.assets){const relative=row.path.slice('apps/wallet-desktop/'.length);assert.equal(stage('/PUBLIC/stage/'+relative,stat),true);assert.equal(unpacked('/PUBLIC/stage/'+relative,stat),!relative.endsWith('.json'));if(!relative.endsWith('.json'))assert.equal(normal('/PUBLIC/project/'+relative,stat),false);}
 for(const name of ['native/foreign.node','native/original-auth-runtime-libs/foreign.dylib','native/.native49-c6-input/apps/wallet-desktop/native/original-auth-identity.node'])assert.equal(stage('/PUBLIC/stage/'+name,stat),false);
 assert.equal(c.files.includes('native/original-auth-identity-build.json'),true);
 assert.deepEqual(metadata.build.files,JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).build.files);
});
test('legacy packages remain unselected; foreign role never falls back',()=>{assert.equal(desktopNative49C6Selected({}),false);assert.throws(()=>desktopNative49C6Selected({ynxNativeComponent:'unknown'}),/C6_UNKNOWN_PACKAGE_SELECTION/);});
test('independent source tuple is checked before any staged asset read',()=>{assert.throws(()=>verifyDesktopNative49C6Input('/PUBLIC/absent',{...selection.sourceRoles,swiftBuilderCommit:'0'.repeat(40)}),/C6_INDEPENDENT_SOURCE_SELECTION/);});
test('changed normal file selection refuses instead of adding an unreviewed overlay',()=>{assert.throws(()=>desktopNative49C6BuilderConfiguration({...metadata,build:{...metadata.build,files:['src/**']}}),/C6_NORMAL_FILE_CONFIGURATION_CHANGED/);});

test('actual builder config loader normalizes the explicit c6 configuration and retains normal hook overrides',async()=>{
 const {getConfig}=require('app-builder-lib/out/util/config/config.js'),project=fileURLToPath(new URL('..',import.meta.url));
 const c=await getConfig(project,project+'/scripts/desktop-native49-c6-builder-config.mjs',{afterPack:'scripts/qa-physical-after-pack.mjs'});
 assert.equal(desktopNative49C6Selected(c.extraMetadata),true);assert.equal(c.afterPack,'scripts/qa-physical-after-pack.mjs');assert.equal(c.asar.smartUnpack,false);
 const stage=c.files.find(row=>row.from==='native/.native49-c6-input/apps/wallet-desktop');assert.equal(stage.filter.length,10);assert.ok(c.files.some(row=>row.from==='../developer/helper'&&row.to==='native/helper-data'));
});
