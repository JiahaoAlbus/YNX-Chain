import assert from "node:assert/strict";
import test from "node:test";
import {createWalletDownloadManifest} from "../src/download-manifest.js";
import {WALLET_DOWNLOAD_MATRIX} from "../src/provider.js";

test("public download manifest is an exact machine-readable view of the current matrix",()=>{
  const sourceCommit="536b961dfed65fb0a93c90d2d50346fa8acdbe0c";
  const manifest=createWalletDownloadManifest({sourceCommit});
  assert.equal(manifest.schema,"ynx.wallet.downloads.v1");
  assert.equal(manifest.sourceCommit,sourceCommit);
  assert.deepEqual(manifest.chain,{name:"YNX Testnet",evmChainId:6423,evmChainHex:"0x1917",nativeSymbol:"YNXT"});
  assert.equal(manifest.packages.length,Object.keys(WALLET_DOWNLOAD_MATRIX).length);
  for(const item of manifest.packages){
    const source=WALLET_DOWNLOAD_MATRIX[item.id];
    assert.deepEqual(item,{
      id:item.id,label:source.label,url:source.url,bytes:source.bytes,sha256:source.sha256,
      contentType:source.contentType,signingClass:source.signingClass,productionSigned:source.productionSigned===true,
      ...(source.fallbackUrl?{fallbackUrl:source.fallbackUrl}:{}),
    });
  }
  assert.equal(manifest.productionSigned,false);
  assert.equal(manifest.storeReleased,false);
});

test("each native package has an explicit same-file GitHub fallback",()=>{
  const nativeKeys=["android","windowsX64","windowsArm64","macosUniversal","linuxX64","linuxArm64"];
  for(const key of nativeKeys){
    const item=WALLET_DOWNLOAD_MATRIX[key],primary=new URL(item.url),fallback=new URL(item.fallbackUrl);
    assert.equal(primary.hostname,"downloads.ynxweb4.com");
    assert.equal(fallback.hostname,"github.com");
    assert.equal(fallback.pathname.split("/").pop(),primary.pathname.split("/").pop());
    assert.match(fallback.pathname,/\/JiahaoAlbus\/YNX-Chain\/releases\/download\//u);
  }
});

test("download manifest rejects a non-commit build identity",()=>{
  assert.throws(()=>createWalletDownloadManifest({sourceCommit:"uncommitted-source-tree"}),/exact source commit/u);
});
