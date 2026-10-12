import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const native=fileURLToPath(new URL('.',import.meta.url));
const packet='/Users/huangjiahao/.ynx-ide-build-artifacts-b55-20261011/general-selected-cdn-r3-20261011/ide-normal-wallet-parent-acquire-outcome-r5-20261012';
const controls=join(packet,'public-controls');mkdirSync(controls,{recursive:true});
const run=mkdtempSync(join(controls,'run-'));
const clang='/Library/Developer/CommandLineTools/usr/bin/clang';
const sdk='/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';
const events=[];
function execute(command,args,options={}){
  const r=spawnSync(command,args,{encoding:'utf8',timeout:30000,...options});
  events.push({command,args,status:r.status,signal:r.signal,error:r.error?.code,stdout:r.stdout,stderr:r.stderr});
  writeFileSync(join(run,'RAW_COMMANDS.json'),JSON.stringify(events,null,2));
  return r;
}
const flags=['-fobjc-arc','-mmacosx-version-min=15.0','-isysroot',sdk];
const probe=join(run,'public-probe');let legacyProbe;
before(()=>{
  assert.ok(existsSync(clang)&&existsSync(sdk),'Use retained explicit CLT, no xcrun/download');
  const result=execute(clang,[...flags,join(native,'wallet-admission-parent-test.m'),'-o',probe,'-framework','Foundation','-framework','Security']);
  assert.equal(result.status,0,result.stderr);
});
function fixture(binary,mode){
  const app=mkdtempSync(join(run,'fixture-'))+'/public-probe.app';
  const mac=join(app,'Contents/MacOS'),resources=join(app,'Contents/Resources');
  mkdirSync(mac,{recursive:true});mkdirSync(join(resources,'runtime'),{recursive:true});
  copyFileSync(binary,join(mac,'public-probe'));
  writeFileSync(join(app,'Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>invalid.ynx.public-observation-probe</string><key>CFBundleExecutable</key><string>public-probe</string></dict></plist>');
  if(mode==='fifo-node')assert.equal(execute('/usr/bin/mkfifo',[join(resources,'runtime/node')]).status,0);
  else writeFileSync(join(resources,'runtime/node'),'PUBLIC metadata only, never executable code',{mode:0o755});
  if(mode==='fifo-entry')assert.equal(execute('/usr/bin/mkfifo',[join(resources,'server.mjs')]).status,0);
  else writeFileSync(join(resources,'server.mjs'),'PUBLIC metadata only, never executed');
  return join(mac,'public-probe');
}
function publicCase(mode){
  const r=execute(fixture(probe,mode),[mode],{timeout:3000});
  assert.equal(r.error,undefined,r.error?.message);assert.equal(r.status,0,r.stderr+' '+r.stdout);
  const observed=JSON.parse(r.stdout.trim());assert.equal(observed.guardNil,true);return observed;
}
test('R5 PUBLIC F1: clean refusal has no guard/debt and normal cleanup permits completion',()=>{
  assert.equal(publicCase('clean-refusal').cleanupComplete,true);
});
test('R5 PUBLIC F1: failed acquire close reaches real backend and shared quit decision once',()=>{
  const result=publicCase('close-failure');assert.equal(result.cleanupComplete,false);assert.equal(result.firstCausePreserved,true);
});
test('R5 PUBLIC F1: original capture exception and independent cleanup error retain exact identity',()=>{
  assert.equal(publicCase('exception-close-failure').cleanupComplete,false);
});
test('R5 PUBLIC F2: runtime/node FIFO without writer rejects promptly before opening entry',()=>{
  assert.equal(publicCase('fifo-node').cleanupComplete,true);
});
test('R5 PUBLIC F2: server.mjs FIFO without writer rejects promptly',()=>{
  assert.equal(publicCase('fifo-entry').cleanupComplete,true);
});
test('R5 changed normal main connects acquire outcome, backend transfer and same quit gate',()=>{
  const main=readFileSync(join(native,'main.m'),'utf8');
  assert.match(main,/_localWalletAdmissionAcquireOutcome=YNXAcquireWalletAdmissionOutcome/);
  assert.match(main,/initWithAcquireOutcome:_localWalletAdmissionAcquireOutcome/);
  assert.ok(main.includes("YNXWalletAdmissionCleanupMayFinish(_server,_localWalletAdmissionAcquireOutcome,_localWalletAdmissionParent)"));
});
test('R5 actual full native main links real getter with a strong definition; binary is not executed',()=>{
  const output=join(run,'YNXDeveloper-link-only');
  const result=execute(clang,[...flags,join(native,'main.m'),join(native,'ynx-wallet-admission-parent.m'),'-o',output,'-framework','Cocoa','-framework','Security','-framework','WebKit']);
  assert.equal(result.status,0,result.stderr);
  const symbols=execute('/usr/bin/nm',['-gU',output]);assert.equal(symbols.status,0,symbols.stderr);
  assert.match(symbols.stdout,/\bT _YNXOriginalAcquireIDEAdmissionParent(?:\n|$)/);
});
test('R5 PUBLIC counterfactual: exact R4 hides failed-close debt and blocks on the same FIFO',()=>{
  const baseline=join(run,'r4-exact-source');mkdirSync(baseline);
  const frozen='/Users/huangjiahao/.ynx-ide-build-artifacts-b55-20261011/general-selected-cdn-r3-20261011/ide-normal-wallet-parent-native-qualification-r4-20261012/frozen-source/apps/developer/desktop/macos';
  for(const leaf of ['ynx-wallet-admission-parent.h','ynx-wallet-admission-parent.m','ynx-wallet-admission-launch.h'])copyFileSync(join(frozen,leaf),join(baseline,leaf));
  copyFileSync(join(native,'wallet-admission-parent-test.m'),join(baseline,'wallet-admission-parent-test.m'));
  legacyProbe=join(run,'public-probe-r4');
  const linked=execute(clang,[...flags,'-DPUBLIC_LEGACY_R4=1',join(baseline,'wallet-admission-parent-test.m'),'-o',legacyProbe,'-framework','Foundation','-framework','Security']);
  assert.equal(linked.status,0,linked.stderr);
  const failedClose=execute(fixture(legacyProbe,'close-failure'),['close-failure'],{timeout:3000});
  assert.equal(failedClose.status,0,failedClose.stderr);
  const old=JSON.parse(failedClose.stdout.trim());assert.equal(old.cleanupComplete,true);assert.equal(old.firstCausePresent,false);
  const fifo=execute(fixture(legacyProbe,'fifo-node'),['fifo-node'],{timeout:1000});
  assert.equal(fifo.error?.code,'ETIMEDOUT','The frozen blocking open must expose the recorded old defect');
  assert.equal(fifo.status,null);
});
