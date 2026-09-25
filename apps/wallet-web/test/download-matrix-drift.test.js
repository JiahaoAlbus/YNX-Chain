import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {WALLET_DOWNLOAD_MATRIX} from "../src/provider.js";

const readJSON=async relative=>JSON.parse(await readFile(new URL(relative,import.meta.url),"utf8"));

test("Wallet install entry stays bound to current Android and published Web artifacts",async()=>{
  const [nativeManifest,publicChannels]=await Promise.all([
    readJSON("../../wallet/artifact-manifest.json"),
    readJSON("../public-channel-manifest.json"),
  ]);
  const android=nativeManifest.artifacts.find(item=>item.name==="android-release-apk");
  assert.ok(android?.url);assert.deepEqual(
    {bytes:WALLET_DOWNLOAD_MATRIX.android.bytes,sha256:WALLET_DOWNLOAD_MATRIX.android.sha256},
    {bytes:android.bytes,sha256:android.sha256},
  );
  assert.equal(WALLET_DOWNLOAD_MATRIX.android.url,android.url);
  assert.equal(WALLET_DOWNLOAD_MATRIX.android.fallbackUrl,android.url);
  assert.equal(WALLET_DOWNLOAD_MATRIX.android.filename,android.filename);
  assert.equal(WALLET_DOWNLOAD_MATRIX.android.assetPath,new URL(android.url).pathname);
  assert.equal(WALLET_DOWNLOAD_MATRIX.android.releaseTag,nativeManifest.publishedRelease.tag);
  const receipt=await readJSON("../../wallet/proof/wallet-android-1.0.20-publication-20260924.json");
  for(const source of [nativeManifest,WALLET_DOWNLOAD_MATRIX.android]){
    assert.equal(source.releaseImmutable,false);
    assert.equal(source.publisherCanReplaceAssets,true);
    assert.equal(source.downloadTimeSha256Verified,false);
  }
  assert.equal(receipt.releaseImmutable,false);
  assert.equal(receipt.downloadTimeSha256Verified,true);
  assert.equal(receipt.observedAt,WALLET_DOWNLOAD_MATRIX.android.releaseMetadataObservedAt);
  assert.deepEqual(Object.keys(publicChannels.channels).sort(),["pwaPackage","chromeEdgeExtension","firefoxExtension"].sort());
  for(const [key,artifact] of Object.entries(publicChannels.channels)){
    const entry=WALLET_DOWNLOAD_MATRIX[key];
    assert.equal(entry.hosted,true);assert.equal(entry.url,artifact.url);
    assert.equal(entry.bytes,artifact.bytes);assert.equal(entry.sha256,artifact.sha256);
    assert.equal(new URL(artifact.url).pathname.endsWith(`/${artifact.name}`),true);
    assert.equal(artifact.url.includes(`/sha256-${artifact.sha256}/`),true);
    assert.match(artifact.sourceCommit,/^[0-9a-f]{40}$/u);
  }
  assert.equal(publicChannels.channels.chromeEdgeExtension.version,"0.1.3");
  assert.equal(publicChannels.channels.pwaPackage.version,"0.1.1");
  assert.equal(publicChannels.channels.firefoxExtension.version,"0.1.1");
});
