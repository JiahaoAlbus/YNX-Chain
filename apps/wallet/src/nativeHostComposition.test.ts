import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,mkdirSync,symlinkSync,realpathSync,rmSync} from "node:fs";
import path from "node:path";
import os from "node:os";
import {runInNewContext} from "node:vm";
import test from "node:test";

const source=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8").replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/[^\n]*/g,"");

test("Android Expo host uses the application variant, never dependency DEBUG or unconditional development support",()=>{
  const application=source("../android/app/src/main/java/com/ynxweb4/wallet/MainApplication.kt");
  assert.match(application,/ExpoReactHostFactory\.getDefaultReactHost\(/);
  const argumentsFound=[...application.matchAll(/\buseDevSupport\s*=\s*([^\n,)]+)/g)];
  assert.equal(argumentsFound.length,1);
  assert.equal((argumentsFound[0]?.[1]??"").trim(),"BuildConfig.DEBUG");
  assert.doesNotMatch(application,/import\s+com\.facebook\.react\.common\.build\.ReactBuildConfig/);
});

test("ordinary Android debug still uses Metro and release keeps original embedded bundle and signing separation",()=>{
  const gradle=source("../android/app/build.gradle");
  assert.match(gradle,/bundleCommand\s*=\s*"export:embed"/);
  assert.doesNotMatch(gradle,/debuggableVariants\s*=/);
  assert.match(gradle,/debug\s*\{\s*signingConfig\s+signingConfigs\.debug/);
  assert.match(gradle,/signingConfig\s+ynxReleaseSigningConfigured\s*\?\s*signingConfigs\.release\s*:\s*null/);
});

test("iOS retains its original DEBUG Metro and release embedded-bundle distinction",()=>{
  const delegate=source("../ios/YNXWallet/AppDelegate.swift");
  assert.match(delegate,/#if DEBUG[\s\S]*return RCTBundleURLProvider\.jsBundleURL\([\s\S]*packagerHost: location/);
  assert.match(delegate,/return provider\.jsBundleURL\(forBundleRoot: "\.expo\/\.virtual-metro-entry"\)\s+#else\s+return Bundle\.main\.url\(forResource: "main", withExtension: "jsbundle"\)\s+#endif/);
});

for(const linked of [false,true])test(`Metro includes the actual installed graph (${linked?"linked":"ordinary"}), preserving the exact registry resolver`,()=>{
  const temporary=mkdtempSync(path.join(os.tmpdir(),"ynx-wallet-host-config-"));
  try{
    const project=path.join(temporary,"source/apps/wallet");mkdirSync(project,{recursive:true});
    const installed=linked?path.join(temporary,"dependencies/node_modules"):path.join(project,"node_modules");
    mkdirSync(path.join(installed,"@ynx-chain"),{recursive:true});
    const sdk=path.join(temporary,"admitted-sdk/wallet-auth");mkdirSync(sdk,{recursive:true});
    symlinkSync(sdk,path.join(installed,"@ynx-chain/wallet-auth"));
    if(linked)symlinkSync(installed,path.join(project,"node_modules"));
    const module={exports:{} as any};
    const inherited=path.join(temporary,"inherited-watch");
    runInNewContext(readFileSync(new URL("../metro.config.js",import.meta.url),"utf8"),{
      __dirname:project,module,require:(name:string)=>{
        if(name==="expo/metro-config")return {getDefaultConfig:()=>({watchFolders:[inherited],resolver:{extraNodeModules:{existing:"preserved"}}})};
        if(name==="node:path")return path;
        if(name==="node:fs")return {realpathSync};
        throw Error(`Unexpected config dependency ${name}`);
      }
    });
    const config=module.exports;
    assert.ok(config.watchFolders.includes(realpathSync(installed)));
    assert.ok(config.watchFolders.includes(realpathSync(sdk)));
    assert.ok(config.watchFolders.includes(inherited));
    assert.ok(config.watchFolders.includes(path.resolve(project,"../..")));
    assert.deepEqual(Array.from(config.resolver.nodeModulesPaths),[realpathSync(installed)]);
    assert.equal(config.resolver.extraNodeModules.expo,path.join(realpathSync(installed),"expo"));
    assert.equal(config.resolver.extraNodeModules.existing,"preserved");
    const registry=config.resolver.resolveRequest({},"../../../../packages/wallet-auth/product-session-registry.json","android");
    assert.equal(registry.filePath,path.join(realpathSync(sdk),"product-session-registry.json"));
    assert.equal(registry.type,"sourceFile");
    const calls:unknown[]=[];
    const result=config.resolver.resolveRequest({resolveRequest:(...args:unknown[])=>{calls.push(args);return "unchanged"}},"@walletconnect/react-native-compat","ios");
    assert.equal(result,"unchanged");assert.equal(calls.length,1);
  }finally{rmSync(temporary,{recursive:true,force:true})}
});
