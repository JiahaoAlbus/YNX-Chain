import test from "node:test";
import assert from "node:assert/strict";
import * as runtimeBranding from "../src/wallet-runtime-branding.mjs";
const {configureWalletRuntimeBranding,readWalletQASourceFingerprint}=runtimeBranding;
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,symlinkSync} from "node:fs";
import os from "node:os";
import path from "node:path";
for(const packaged of [true,false])test(`runtime brand uses original icon and accurate ${packaged?"packaged":"QA"} identity`,()=>{
  const calls={},icon={isEmpty:()=>false},app={isPackaged:packaged,getVersion:()=>"0.6.8",getAppPath:()=>"/tmp/locale-source/apps/wallet-desktop",setName:value=>calls.name=value,setAboutPanelOptions:value=>calls.about=value,dock:{setIcon:value=>calls.icon=value}};
  const Menu={buildFromTemplate:value=>value,setApplicationMenu:value=>calls.menu=value},nativeImage={createFromPath:value=>{calls.path=value;return icon}};
  let fingerprintCalls=0;
  const branding=configureWalletRuntimeBranding({app,Menu,nativeImage,directory:"/tmp/locale-source/apps/wallet-desktop/src",sourceFingerprint:()=>{fingerprintCalls++;return "ab".repeat(32)}});
  assert.equal(calls.name,"YNX Wallet");assert.equal(calls.icon,icon);assert.match(calls.path,/src\/icon.png$/);assert.equal(calls.menu[0].label,"YNX Wallet");assert.equal(calls.about.applicationVersion,"0.6.8");
  assert.equal(branding.title,packaged?"YNX Wallet":"YNX Wallet · 测试构建 / QA · abababababab");assert.equal(calls.about.copyright.includes("Not an official release"),!packaged);assert.equal(fingerprintCalls,packaged?0:1);if(!packaged){assert.match(calls.about.copyright,/Source: locale-source/);assert.match(calls.about.copyright,/Owned app source SHA256: (ab){32}/);assert.match(calls.about.applicationName,/测试构建/)}
});

test("QA source fingerprint identifies actual public app bytes, not folder names or custody files",()=>{
  const fixture=mkdtempSync(path.join(os.tmpdir(),"ynx-wallet-qa-identity-"));
  try{
    const src=path.join(fixture,"src");mkdirSync(src);
    writeFileSync(path.join(fixture,"package.json"),'{"version":"0.6.8"}');
    for(const name of ["main.mjs","renderer.js","preload.cjs","index.html","styles.css"])writeFileSync(path.join(src,name),name);
    const before=readWalletQASourceFingerprint(src);assert.match(before,/^[0-9a-f]{64}$/);
    assert.equal(readWalletQASourceFingerprint(src),before);
    // Unrelated fixture data and links are never opened for this public identity.
    writeFileSync(path.join(fixture,"unrelated-fixture.txt"),"not an app source file");
    symlinkSync(path.join(fixture,"unrelated-fixture.txt"),path.join(src,"unrelated.mjs"));
    assert.equal(readWalletQASourceFingerprint(src),before);
    writeFileSync(path.join(src,"renderer.js"),"changed public renderer");
    assert.notEqual(readWalletQASourceFingerprint(src),before);
    const rendererChanged=readWalletQASourceFingerprint(src);
    writeFileSync(path.join(fixture,"package.json"),'{"version":"synthetic-changed"}');
    assert.notEqual(readWalletQASourceFingerprint(src),rendererChanged);
  }finally{rmSync(fixture,{recursive:true,force:true})}
});

for(const value of [()=>{throw Error("synthetic inaccessible source")},()=>"bad",()=>"a".repeat(63)])test("missing or invalid QA source identity is explicitly unverified, not an official-looking title",()=>{
  let about;
  const app={isPackaged:false,getAppPath:()=>"/tmp/source/apps/wallet-desktop",getVersion:()=>"0.6.8",setName:()=>{},setAboutPanelOptions:v=>about=v};
  const branding=configureWalletRuntimeBranding({app,Menu:{buildFromTemplate:v=>v,setApplicationMenu:()=>{}},nativeImage:{createFromPath:()=>({isEmpty:()=>false})},directory:"/tmp/source/apps/wallet-desktop/src",sourceFingerprint:value});
  assert.match(branding.title,/测试构建 \/ QA · 源码未验证$/);assert.match(about.copyright,/Owned app source SHA256: NOT_VERIFIED/);
});

test("activation, authorization completion and page-title changes retain the computed runtime identity",()=>{
  const main=readFileSync(new URL("../src/main.mjs",import.meta.url),"utf8");
  assert.match(main,/walletWindowTitle=branding\.title/);
  assert.equal((main.match(/mainWindow\.setTitle\(walletWindowTitle\)/g)??[]).length,2);
  assert.doesNotMatch(main,/mainWindow\.setTitle\("YNX Wallet"/);
  assert.match(main,/page-title-updated[\s\S]*?window\.setTitle\(branding\.title\)/);
});
