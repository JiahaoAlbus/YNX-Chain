import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {WALLET_DOWNLOAD_MATRIX} from "../src/provider.js";

const readJSON=async relative=>JSON.parse(await readFile(new URL(relative,import.meta.url),"utf8"));

test("Wallet install entry stays bound to current Android and published Web artifacts",async()=>{
  const [nativeManifest,webManifest]=await Promise.all([
    readJSON("../../wallet/artifact-manifest.json"),
    readJSON("../artifact-manifest.json"),
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
  const receipt=await readJSON("../../wallet/proof/wallet-android-1.0.16-publication-20260920.json");
  for(const source of [nativeManifest,receipt,WALLET_DOWNLOAD_MATRIX.android]){
    assert.equal(source.releaseImmutable,false);
    assert.equal(source.publisherCanReplaceAssets,true);
    assert.equal(source.downloadTimeSha256Verified,false);
  }
  assert.equal(receipt.githubReleaseObservation.immutable,false);
  assert.equal(receipt.githubReleaseObservation.observedAt,WALLET_DOWNLOAD_MATRIX.android.releaseMetadataObservedAt);
  const expected={
    pwaPackage:"ynx-wallet-web-pwa-0.1.1.zip",
    chromeEdgeExtension:"ynx-wallet-chrome-edge-0.1.1.zip",
    firefoxExtension:"ynx-wallet-firefox-0.1.1.zip",
  };
  for(const [key,name] of Object.entries(expected)){
    const artifact=webManifest.artifacts.find(item=>item.name===name),entry=WALLET_DOWNLOAD_MATRIX[key];
    assert.ok(artifact,`missing ${name}`);assert.equal(entry.hosted,true);assert.ok(entry.url);
    assert.equal(entry.bytes,artifact.bytes);assert.equal(entry.sha256,artifact.sha256);assert.ok(entry.url.endsWith(`/${name}`));
  }
});
