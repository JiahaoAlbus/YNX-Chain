import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {nativeSDKInput,nativePinSource,validateNativeSDKManifest,nativeSources,generateNativeSDK} from '../../scripts/generate-wallet-sdk.mjs';
import {CURRENT_WALLET_SDK} from '../../../../seller-console/scripts/current-wallet-sdk.mjs';

const native=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const oldSHA='a7d0f2a8bac2780f3b4db39a904245947cf5ed7a20ea62933b18e7e5369c8f82';
const input=await nativeSDKInput('android');

test('Native input resolves official constructor and gateway from exact R9 package',async()=>{
    assert.equal(input.constructor,resolve(input.sdk.root,'src/product-session-native.js'));
    assert.equal(input.gateway,resolve(input.sdk.root,'src/product-session-gateway-client.js'));
    assert.ok(!input.entry.includes('Browser')&&!input.entry.includes('createProductWalletConnection'));
    const recovery=await readFile(resolve(input.sdk.root,'src/product-session-recovery.js'));
    assert.equal(createHash('sha256').update(recovery).digest('hex'),'e80eeb44d78d0b91f67c18c8593bea4be89235eef20b3e7b66c664d2b4555b8b');
});

test('relative Native closure excludes browser factory and Node-only builtins',async()=>{
    const seen=new Set();
    async function visit(path){
        if(seen.has(path))return;seen.add(path);
        assert.ok(path.startsWith(input.sdk.root+'/'));
        assert.ok(!path.endsWith('/product-session-browser.js'));
        const text=await readFile(path,'utf8');
        for(const match of text.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)){
            assert.ok(!match[1].startsWith('node:'));
            if(match[1].startsWith('.'))await visit(resolve(dirname(path),match[1]));
        }
    }
    await visit(input.constructor);await visit(input.gateway);
    assert.ok(seen.has(resolve(input.sdk.root,'src/product-session-recovery.js')));
});

test('legacy real modules cannot be relabelled as R9 or supply compiled current pins',async()=>{
    for(const platform of ['android','apple']){
        const bytes=await readFile(resolve(nativeSources[platform],'wallet-auth-native-consumer.mjs'));
        assert.equal(createHash('sha256').update(bytes).digest('hex'),oldSHA);
        const relabelled={schemaVersion:1,platform,archiveSHA256:CURRENT_WALLET_SDK.sha256,sourceHead:CURRENT_WALLET_SDK.sourceHead,sourceTree:CURRENT_WALLET_SDK.sourceTree,constructor:'createNativeProductSessionClient',sha256:oldSHA,bytes:bytes.length};
        assert.throws(()=>validateNativeSDKManifest(relabelled,bytes,platform),/mismatch/);
        assert.throws(()=>nativePinSource(platform,oldSHA),/actual current/);
    }
    assert.throws(()=>nativePinSource('apple',undefined),/actual current/);
});

test('normal Android recipe consumes only generated assets and compiled pin source',async()=>{
    const gradle=await readFile(resolve(native,'android/app/build.gradle'),'utf8');
    assert.ok(gradle.includes('preBuild')&&gradle.includes('dependsOn(generateCommerceNativeSDK)'));
    assert.ok(gradle.includes('assets.setSrcDirs')&&gradle.includes('"assets"'));
    assert.ok(gradle.includes('java.srcDir')&&gradle.includes('"sources"'));
    for(const relative of ['../../scripts/generate-wallet-sdk.mjs','../../../../seller-console/scripts/current-wallet-sdk.mjs','../../../../seller-console/vendor/ynx-chain-wallet-auth-1.2.0-r9.tgz'])assert.ok((await readFile(resolve(native,'android/app',relative))).length>0);
    const reader=await readFile(resolve(native,'android/app/src/main/java/com/ynxweb4/shop/NativeSessionBridge.java'),'utf8');
    assert.ok(reader.includes('SDK_SHA=NativeSDKPin.SHA256')&&reader.includes('sdk-manifest.json'));
    assert.ok(!reader.includes(oldSHA));
});

test('both normal Apple targets generate before compilation and use derived module/pin',async()=>{
    const project=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',resolve(native,'ios/YNXShop.xcodeproj/project.pbxproj')],{encoding:'utf8'})).objects;
    for(const id of ['A00000000000000000000005','C00000000000000000000005']){
        const phases=project[id].buildPhases;
        assert.equal(project[phases[0]].isa,'PBXShellScriptBuildPhase');
        assert.ok(project[phases[0]].shellScript.includes('generate-wallet-sdk.mjs'));
        assert.ok(project[phases[0]].shellScript.includes('apple'));
        const sources=phases.find(id=>project[id].isa==='PBXSourcesBuildPhase');
        assert.ok(project[sources].files.includes('B00000000000000000000024'));
    }
    assert.ok(project.B00000000000000000000013.path.includes('$(DERIVED_FILE_DIR)/commerce-native-r9/native-session'));
    assert.ok(project.B00000000000000000000014.path.endsWith('NativeSDKPin.swift'));
    const reader=await readFile(resolve(native,'ios/YNXShop/NativeSessionBridge.swift'),'utf8');
    assert.ok(reader.includes('sdkSHA=NativeSDKPin.sha256')&&reader.includes('sdk-manifest.json'));
    assert.ok(!reader.includes(oldSHA));
});

test('generation refuses to overwrite either original source asset directory before bundling',async()=>{
    await assert.rejects(generateNativeSDK('android',nativeSources.android),/must not overwrite/);
    await assert.rejects(generateNativeSDK('apple',nativeSources.apple),/must not overwrite/);
});
