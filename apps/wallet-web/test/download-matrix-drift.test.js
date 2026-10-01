import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {WALLET_DOWNLOAD_MATRIX,YNX_DOWNLOAD_URL} from "../src/provider.js";
test("current installer selection uses the official catalog and never packaged snapshot links",async()=>{
 const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
 assert.equal(YNX_DOWNLOAD_URL,"https://www.ynxweb4.com/dapp/wallet/open-download");
 assert.match(app,/id="current-wallet-downloads" href="\$\{YNX_DOWNLOAD_URL\}"/);
 assert.doesNotMatch(app,/packageSources|WALLET_DOWNLOAD_MATRIX\./);
 for(const item of Object.values(WALLET_DOWNLOAD_MATRIX)){
  assert.equal(item.productionSigned,false);assert.ok(item.bytes>0);assert.match(item.sha256,/^[0-9a-f]{64}$/);
  assert.equal(new URL(item.url).protocol,"https:");
 }
 assert.equal(WALLET_DOWNLOAD_MATRIX.windowsX64.sha256,"c4c3882d3693854def331a136200a5ed76be091591ba3c4e180b4e2cf89ad60f");
 assert.equal(WALLET_DOWNLOAD_MATRIX.windowsX64.bytes,121092869);
 assert.match(WALLET_DOWNLOAD_MATRIX.windowsX64.url,/0\.6\.18-x64\.exe$/);
 assert.equal(WALLET_DOWNLOAD_MATRIX.android.sha256,"78c7221821add4cba78ece2069fea05a98b7c15cc3ba3e93a25fc0b0214f8509");
});
