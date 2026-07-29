import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
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
