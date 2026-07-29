import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("browser accessibility audit uses a real local Chrome CDP session without production dependencies", async () => {
  const script = await read("scripts/browser-accessibility-audit.mjs");
  const packageJSON = JSON.parse(await read("package.json"));
  assert.equal(packageJSON.scripts["accessibility:audit"], "node scripts/browser-accessibility-audit.mjs");
  assert.match(script, /Chrome DevTools Protocol/);
  assert.match(script, /Page\.captureScreenshot/);
  assert.match(script, /Accessibility\.getFullAXTree/);
  assert.match(script, /Input\.dispatchKeyEvent/);
  assert.match(script, /Emulation\.setEmulatedMedia/);
  assert.match(script, /Emulation\.setPageScaleFactor/);
  assert.match(script, /sourceDirtyAtStart/);
  assert.doesNotMatch(JSON.stringify(packageJSON), /playwright|puppeteer/i);
});

test("browser audit covers keyboard, screen-reader, RTL, reduced-motion, dark, zoom and 390px gates", async () => {
  const script = await read("scripts/browser-accessibility-audit.mjs");
  for (const gate of [
    "keyboard-first-focus-skip-link",
    "skip-link-focuses-editor",
    "panel-tabs-roving-keyboard",
    "screen-reader-accessibility-tree",
    "visible-focus-indicator",
    "desktop-dark-theme",
    "reduced-motion-disables-animation",
    "mobile-390-no-page-overflow",
    "mobile-closed-drawers-inert",
    "arabic-rtl-with-code-ltr",
    "dynamic-large-text-390",
    "page-scale-200-percent",
  ]) assert.match(script, new RegExp(gate));
});

test("committed accessibility evidence and public metadata preserve exact hashes and release boundaries", async () => {
  const evidence = JSON.parse(await read("evidence/ui/current-accessibility/accessibility-audit.json"));
  const metadata = JSON.parse(await read("public-product-metadata.json"));
  const release = JSON.parse(await read("product-release.json"));
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.sourceDirtyAtStart, false);
  assert.equal(evidence.checks.filter((item) => item.status === "passed").length, 15);
  assert.equal(evidence.screenshots.length, 6);
  for (const screenshot of evidence.screenshots) {
    const bytes = await readFile(`${repositoryRoot}/${screenshot.path}`);
    assert.equal(bytes.length, screenshot.bytes, screenshot.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), screenshot.sha256, screenshot.path);
  }
  assert.equal(metadata.officialDomain, "https://ynxweb4.com");
  assert.equal(metadata.canonicalUrl, "https://ynxweb4.com/developer");
  assert.equal(metadata.deployedPublic, false);
  assert.equal(metadata.publicRouteVerified, false);
  assert.equal(metadata.publicEvidence.immutableArtifactUrls.length, 0);
  assert.equal(release.browserAccessibilityEvidence.status, "passed");
  assert.equal(release.browserAccessibilityEvidence.independentCertification, false);
  assert.equal(release.deployedPublic, false);
  assert.equal(release.productionSigned, false);
});
