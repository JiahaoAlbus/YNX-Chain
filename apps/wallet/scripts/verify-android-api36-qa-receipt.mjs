#!/usr/bin/env node
import {createHash} from "node:crypto";
import {readFile, stat} from "node:fs/promises";
import path from "node:path";

const [artifactDirectory,receiptPath]=process.argv.slice(2);
if(!artifactDirectory||!receiptPath)fail("usage: verify-android-api36-qa-receipt.mjs /absolute/artifact-dir /absolute/receipt.json");
for(const value of [artifactDirectory,receiptPath])if(!path.isAbsolute(value))fail("artifact and receipt paths must be absolute");
const manifest=await json(path.join(artifactDirectory,"manifest.json"));
const receipt=await json(receiptPath);
exact(manifest,["schemaVersion","artifactType","sourceCommit","package","versionName","versionCode","minimumOS","compileSdk","targetSdk","abi","apk","signingClass","signerCertificateSha256","apkSignatureSchemeV2","keyValidityDays","installedLocal","productionSigned","storeReleased","secretMaterialRecorded"],"artifact manifest");
exact(receipt,["schemaVersion","sourceCommit","apkSha256","package","apiLevel","androidRelease","abi","install","firstColdLaunch","secondColdLaunch","logs","privacy","chainIdentity","rawEvidence","secretMaterialRecorded"],"QA receipt");
const apk=path.join(artifactDirectory,manifest.apk.name);
const apkBytes=await readFile(apk),apkStat=await stat(apk),apkSha=sha(apkBytes);
assert(manifest.schemaVersion===1&&manifest.artifactType==="wallet-android-disposable-qa-release","artifact schema mismatch");
assert(manifest.sourceCommit===receipt.sourceCommit&&/^[0-9a-f]{40}$/.test(receipt.sourceCommit),"source commit mismatch");
assert(manifest.package==="com.ynxweb4.wallet"&&receipt.package===manifest.package,"package mismatch");
assert(manifest.apk.bytes===apkStat.size&&manifest.apk.sha256===apkSha&&receipt.apkSha256===apkSha,"APK digest/bytes mismatch");
assert(manifest.signingClass==="disposable-qa-release-key"&&manifest.productionSigned===false&&manifest.storeReleased===false,"signing boundary mismatch");
assert(receipt.apiLevel===36&&receipt.androidRelease===16&&receipt.abi==="arm64-v8a","API 36 target mismatch");
exact(receipt.install,["result","freshInstall"],"install");
assert(receipt.install.result==="Success"&&receipt.install.freshInstall===true,"fresh install did not pass");
for(const key of ["firstColdLaunch","secondColdLaunch"]){const launch=receipt[key];exact(launch,["passed","pid","topResumedActivity","focusedWindow","intent"],key);assert(launch.passed===true&&Number.isSafeInteger(launch.pid)&&launch.pid>0,`${key} failed`);assert(launch.topResumedActivity==="com.ynxweb4.wallet/.MainActivity",`${key} top activity mismatch`);assert(launch.focusedWindow.includes("com.ynxweb4.wallet.MainActivity"),`${key} focused window mismatch`)}
assert(receipt.firstColdLaunch.pid!==receipt.secondColdLaunch.pid,"second cold launch must use a distinct PID");
exact(receipt.logs,["firstPidReactMain","secondPidReactMain","fatalExceptionCount","androidRuntimeCrashCount"],"logs");
assert(receipt.logs.firstPidReactMain===true&&receipt.logs.secondPidReactMain===true&&receipt.logs.fatalExceptionCount===0&&receipt.logs.androidRuntimeCrashCount===0,"PID-scoped log gate failed");
exact(receipt.privacy,["flagSecureObserved","applicationRegionBlack","systemBarsVisible","screenshotSha256","screenshotBytes"],"privacy");
assert(receipt.privacy.flagSecureObserved===true&&receipt.privacy.applicationRegionBlack===true&&receipt.privacy.systemBarsVisible===true,"FLAG_SECURE gate failed");
assert(/^[0-9a-f]{64}$/.test(receipt.privacy.screenshotSha256)&&Number.isSafeInteger(receipt.privacy.screenshotBytes)&&receipt.privacy.screenshotBytes>0,"privacy screenshot evidence invalid");
exact(receipt.chainIdentity,["nativeChainId","evmChainIdDecimal","evmChainIdHex"],"chainIdentity");
assert(receipt.chainIdentity.nativeChainId==="ynx_6423-1"&&receipt.chainIdentity.evmChainIdDecimal===6423&&receipt.chainIdentity.evmChainIdHex==="0x1917","chain identity mismatch");
assert(receipt.secretMaterialRecorded===false,"receipt must not contain secret material");
assert(Array.isArray(receipt.rawEvidence)&&receipt.rawEvidence.length>=6,"at least six raw evidence files are required");
for(const item of receipt.rawEvidence){exact(item,["label","path","sha256","bytes"],"raw evidence item");assert(typeof item.label==="string"&&/^[a-z][a-z0-9-]{2,63}$/.test(item.label),"raw evidence label invalid");assert(path.isAbsolute(item.path),"raw evidence path must be absolute");const body=await readFile(item.path),info=await stat(item.path);assert(info.isFile()&&info.size===item.bytes&&sha(body)===item.sha256,"raw evidence digest/bytes mismatch")}
console.log(JSON.stringify({verified:true,sourceCommit:receipt.sourceCommit,apkSha256:apkSha,installedLocal:true,firstColdLaunch:true,secondColdLaunch:true,flagSecure:true,chainIdentity:true,productionSigned:false,storeReleased:false,secretMaterialRecorded:false},null,2));

async function json(file){let value;try{value=JSON.parse(await readFile(file,"utf8"))}catch{fail(`invalid JSON: ${file}`)}return value}
function exact(value,keys,label){assert(value&&typeof value==="object"&&!Array.isArray(value),`${label} must be an object`);assert(Object.keys(value).sort().join("\n")===keys.slice().sort().join("\n"),`${label} fields mismatch`)}
function sha(value){return createHash("sha256").update(value).digest("hex")}
function assert(condition,message){if(!condition)fail(message)}
function fail(message){console.error(`wallet Android API 36 QA receipt rejected: ${message}`);process.exit(1)}
