import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile,stat} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import sharp from "sharp";
import {chromiumManifest,extensionVersion,firefoxManifest} from "../src/extension-manifest.js";

const store=resolve(dirname(fileURLToPath(import.meta.url)));
const root=resolve(store,"..");
const json=async path=>JSON.parse(await readFile(path,"utf8"));
const text=path=>readFile(path,"utf8");

export async function verifyReleaseMaterials(){
  const [readiness,assetManifest,published,candidate,evidence,listingEn,listingZh,permissions,privacyEn,privacyZh]=await Promise.all([
    json(join(store,"release-readiness.json")),json(join(store,"store-assets.json")),json(join(root,"artifact-manifest.json")),json(join(store,"candidate-artifact-manifest.json")),
    json(join(root,"evidence","runtime","extension-candidate-local-20260925.json")),text(join(store,"listing.en.md")),text(join(store,"listing.zh-CN.md")),
    text(join(store,"permissions-data-map.md")),text(join(store,"privacy-policy.draft.en.md")),text(join(store,"privacy-policy.draft.zh-CN.md")),
  ]);
  assert.equal(readiness.reviewDate,"2026-09-25");
  assert.equal(readiness.baseWebCommit,"6bbf12d87a7274d73b7f2157157954d061b8efd0");
  for(const key of ["submitted","storeReleased","productionSigned","publisherVerified","privacyPolicyPublished"]){assert.equal(readiness[key],false,`${key} must remain false`)}
  assert.equal(readiness.manifest.version,extensionVersion);
  assert.deepEqual({tool:readiness.firefoxLint.tool,errors:readiness.firefoxLint.errors,warnings:readiness.firefoxLint.warnings,reviewed:readiness.firefoxLint.reviewed},{tool:"web-ext 10.6.0",errors:0,warnings:0,reviewed:true});
  assert.equal(readiness.sourceArchiveReady,true);
  assert.match(readiness.candidateCommit,/^[0-9a-f]{40}$/u);
  assert.equal(readiness.candidateReceipt.sourceCommit,readiness.candidateCommit);
  assert.equal(readiness.candidateReceipt.artifacts.length,3);
  for(const artifact of readiness.candidateReceipt.artifacts){assert.ok(Number.isSafeInteger(artifact.bytes)&&artifact.bytes>0);assert.match(artifact.sha256,/^[0-9a-f]{64}$/u);assert.equal(artifact.name.endsWith(".zip"),true)}
  const identity=items=>items.map(({name,bytes,sha256})=>({name,bytes,sha256}));
  const [followup,followupManifest]=await Promise.all([json(join(store,"revocation-followup-candidate-20260925.json")),json(join(store,"revocation-followup-artifact-manifest.json"))]);
  assert.equal(followup.class,"local-followup-candidate");
  assert.equal(followup.previousStoreCandidateCommit,candidate.sourceCommit);
  assert.equal(followup.sourceCommit,followupManifest.sourceCommit);
  assert.deepEqual(followup.artifacts,identity(followupManifest.artifacts));
  assert.notEqual(followup.sourceCommit,candidate.sourceCommit);
  for(const key of ["installedLocal","deployedPublic","downloadHosted","productionSigned","storeReleased"])assert.equal(followup[key],false);
  assert.deepEqual(followup.reviewerSource.cleanExtractedRebuild,{verifiedSourceFiles:249,verifiedOutputFiles:110,authorityArchiveSha256:"4a7eed2da6b1626cce94713a0d4420c56ebedef0d71ee39b7e2cd9bc6762ead7",gitRepositoryRequired:false,externalDependencySymlinks:false,allBytesMatch:true});
  const followupSource=await readFile(join(store,"reviewer-archives",followup.reviewerSource.name));
  assert.equal(followupSource.length,followup.reviewerSource.bytes);
  assert.equal(createHash("sha256").update(followupSource).digest("hex"),followup.reviewerSource.sha256);
  assert.equal(readiness.publicDownloads.sourceCommit,published.sourceCommit);
  assert.equal(readiness.candidateCommit,candidate.sourceCommit);
  assert.equal(evidence.sourceCommit,candidate.sourceCommit);
  assert.notEqual(candidate.sourceCommit,published.sourceCommit);
  assert.deepEqual(readiness.candidateReceipt.artifacts,identity(candidate.artifacts));
  assert.deepEqual(evidence.artifacts,identity(candidate.artifacts));
  assert.deepEqual(evidence.reviewerSource,{
    name:readiness.candidateReceipt.reviewerSource.name,bytes:readiness.candidateReceipt.reviewerSource.bytes,
    sha256:readiness.candidateReceipt.reviewerSource.sha256,sourceFileCount:readiness.candidateReceipt.reviewerSource.sourceFileCount,
    authorityRecords:readiness.candidateReceipt.reviewerSource.authorityRecords,
    verifiedOutputFiles:readiness.candidateReceipt.reviewerSource.expectedOutputFiles,allBytesMatch:true,
  });
  const sourceArchive=join(store,"reviewer-archives",readiness.candidateReceipt.reviewerSource.name);
  const sourceBytes=await readFile(sourceArchive);
  assert.equal(sourceBytes.length,readiness.candidateReceipt.reviewerSource.bytes);
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"),readiness.candidateReceipt.reviewerSource.sha256);
  for(const browser of [evidence.localRuntime.edge,evidence.localRuntime.chromeForTesting])
    for(const field of ["temporaryUnpacked","providerDiscovered","accountAuthorized","messageSigned","signatureRecovered","permissionRevoked","postRevokeDenied"])
      assert.equal(browser[field],true,`${field} local runtime proof missing`);
  assert.deepEqual(evidence.localRuntime.firefoxCompatible,{temporaryAddonLoaded:true,manifestValidated:true,brandedMozillaFirefox:false});
  for(const key of ["installedLocal","downloadHosted","productionSigned","storeReleased"])assert.equal(evidence[key],false);
  assert.equal(readiness.installedCandidateVerified,false);
  assert.equal(readiness.storeSubmissionReady,false);
  assert.equal(readiness.candidateReceipt.reviewerSource.cleanExtractedRebuild.gitRepositoryRequired,false);
  assert.equal(readiness.candidateReceipt.reviewerSource.cleanExtractedRebuild.allBytesMatch,true);
  assert.equal(readiness.candidateReceipt.productionSigned,false);assert.equal(readiness.candidateReceipt.storeReleased,false);
  assert.equal(assetManifest.manifestVersion,extensionVersion);
  assert.deepEqual(chromiumManifest.permissions,["activeTab","scripting","storage"]);
  assert.deepEqual(chromiumManifest.host_permissions,["https://*/*"]);
  assert.equal(chromiumManifest.incognito,"not_allowed");
  assert.equal(chromiumManifest.minimum_chrome_version,"120");
  assert.equal(firefoxManifest.browser_specific_settings.gecko.strict_min_version,"142.0");
  assert.equal(Object.hasOwn(firefoxManifest.browser_specific_settings,"gecko_android"),false);
  assert.deepEqual(firefoxManifest.browser_specific_settings.gecko.data_collection_permissions,{required:["authenticationInfo","financialAndPaymentInfo","websiteContent"]});
  const expectedAssets={"assets/icon-128.png":[128,128],"assets/logo-300.png":[300,300],"assets/promo-small-440x280.png":[440,280],"assets/screenshots/wallet-en-1280x800.png":[1280,800],"assets/screenshots/wallet-zh-CN-1280x800.png":[1280,800]};
  assert.deepEqual(Object.keys(Object.fromEntries(assetManifest.assets.map(item=>[item.path,true]))).sort(),Object.keys(expectedAssets).sort());
  for(const record of assetManifest.assets){
    const path=join(store,record.path),bytes=await readFile(path),info=await stat(path),metadata=await sharp(bytes).metadata();
    assert.equal(record.format,"png");assert.deepEqual([metadata.width,metadata.height],expectedAssets[record.path]);
    assert.equal(record.bytes,info.size);assert.equal(record.sha256,createHash("sha256").update(bytes).digest("hex"));
  }
  for(const [listing,language] of [[listingEn,"English"],[listingZh,"Simplified Chinese"]]){
    assert.match(listing,/0\.1\.1/u);assert.match(listing,/PRIVACY_POLICY_HTTPS_URL/u);assert.match(listing,/VERIFIED_SUPPORT_URL_OR_EMAIL/u);
    assert.match(listing,/6423/u,`${language} listing must identify the Testnet chain`);
  }
  assert.match(permissions,/authenticationInfo/u);assert.match(permissions,/financialAndPaymentInfo/u);assert.match(permissions,/websiteContent/u);
  for(const policy of [privacyEn,privacyZh]){
    assert.match(policy,/PRIVACY_CONTACT/u);assert.match(policy,/RPC_OPERATOR_AND_PROCESSORS/u);assert.match(policy,/SERVER_RETENTION_AND_DELETION_PROCESS/u);
    assert.match(policy,/rpc-testnet\.ynxweb4\.com/u);assert.match(policy,/6423/u);
  }
  assert.equal(published.version,"0.1.1-testnet-preview.1");
  assert.equal(published.productionSigned,false);assert.equal(published.storeReleased,false);
  const publishedFirefox=published.artifacts.find(item=>item.name==="ynx-wallet-firefox-0.1.1.zip");
  assert.ok(publishedFirefox);assert.equal(publishedFirefox.minimumOS,"Firefox 142 desktop");
  const candidateFirefox=candidate.artifacts.find(item=>item.name===publishedFirefox.name);
  assert.ok(candidateFirefox);assert.equal(candidateFirefox.minimumOS,"Firefox 142 desktop");
  assert.equal(evidence.artifacts.find(item=>item.name===candidateFirefox.name)?.sha256,candidateFirefox.sha256);
  return{version:extensionVersion,assets:assetManifest.assets.length,publishedArtifacts:published.artifacts.length,productionSigned:false,storeReleased:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==="--require-local-candidate"),"Unknown store verifier option");
  console.log(JSON.stringify(await verifyReleaseMaterials(),null,2));
  if(process.argv[2]==="--require-local-candidate"){
    execFileSync(process.execPath,[join(root,"scripts","verify-package.mjs")],{
      cwd:root,stdio:"inherit",env:{...process.env,YNX_WALLET_WEB_ARTIFACT_MANIFEST:join(store,"revocation-followup-artifact-manifest.json")},
    });
  }
}
