import test from "node:test";
import assert from "node:assert/strict";
import { verifiedWalletPreviews } from "./wallet-downloads";
import publishedCatalog from "./wallet-download-catalog.json";

const checksum = "e".repeat(64);
const filename = "synthetic-preview.zip";
const item = {
  id: "web-chromium-f90ad90", published: true, publicDownloadVerified: true,
  sha256: checksum, sourceCommit: "b".repeat(40), bytes: 32, filename,
  url: `https://downloads.ynxweb4.com/wallet/sha256-${checksum}/${filename}`,
};
const catalog = (artifact: object) => ({ status: "published-files-verified", artifacts: [artifact] });

test("the frozen public catalog exposes only its reviewed Chromium installer", () => {
  const previews = verifiedWalletPreviews(publishedCatalog);
  assert.equal(previews.length, 1);
  assert.equal(previews[0].id, "web-chromium-f90ad90");
  assert.equal(previews[0].sha256, "061a25cb9b44e6a0e26667b4a46aacffd434780d5c705bea14d4fd7368eab0c5");
  assert.equal(previews[0].bytes, 539744);
  assert.equal(previews[0].sourceCommit, "f90ad909fe30f11ad425adc4871131a82ebc2075");
});

test("only public, verified preview files produce direct download actions", () => {
  assert.equal(verifiedWalletPreviews(catalog(item)).length, 1);
  assert.deepEqual(verifiedWalletPreviews({ status: "prepared-not-published", artifacts: [item] }), []);
  assert.deepEqual(verifiedWalletPreviews(catalog({ ...item, published: false })), []);
  assert.deepEqual(verifiedWalletPreviews(catalog({ ...item, publicDownloadVerified: false })), []);
  assert.deepEqual(verifiedWalletPreviews(catalog({ ...item, url: null, proposedURL: item.url })), []);
});

test("an archive cannot become a launch action or point away from its frozen file", () => {
  for (const url of ["javascript:alert(1)", "http://downloads.ynxweb4.com/file.zip", "https://example.com/file.zip", "https://downloads.ynxweb4.com/wallet", item.url + "?redirect=other", item.url.replace(checksum, "d".repeat(64))]) {
    assert.deepEqual(verifiedWalletPreviews(catalog({ ...item, url })), []);
  }
  for (const id of ["web-pwa-f90ad90", "web-firefox-f90ad90", "web-chromium-882d047", "macos-064-e1945298"]) {
    assert.deepEqual(verifiedWalletPreviews(catalog({ ...item, id })), []);
  }
  assert.deepEqual(verifiedWalletPreviews(catalog({ ...item, id: "web-chromium-future-unreviewed" })), []);
  assert.deepEqual(verifiedWalletPreviews(catalog({ ...item, filename: "../../preview.zip" })), []);
  assert.deepEqual(verifiedWalletPreviews(catalog({ ...item, bytes: 0 })), []);
});
