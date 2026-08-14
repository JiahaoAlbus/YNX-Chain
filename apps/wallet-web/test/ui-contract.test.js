import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("fallback contract always offers YNX download and MetaMask when YNX is absent", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /id="download" href="\$\{YNX_DOWNLOAD_URL\}"/);
  assert.match(source, /id="metamask" href="\$\{METAMASK_DOWNLOAD_URL\}"/);
  assert.match(source, /if \(!state\.providers\?\.metamask\) return/);
  assert.match(source, /walletDiscoveryPresentation\(availability\)/);
});

test("390px RTL dark and large-text preview contracts remain buildable", async () => {
  const [app,styles,accessibility,index] = await Promise.all([
    readFile(new URL("../public/app.js",import.meta.url),"utf8"),
    readFile(new URL("../public/styles.css",import.meta.url),"utf8"),
    readFile(new URL("../public/accessibility.css",import.meta.url),"utf8"),
    readFile(new URL("../public/index.html",import.meta.url),"utf8"),
  ]);
  assert.match(index,/<html lang="en">/);
  assert.match(app,/document\.documentElement\.dir = isRTL\(state\.locale\)/);
  assert.match(app,/requestedText === "large"/);
  assert.match(app,/loadPreferences\(localStorage\)/);
  assert.match(app,/acceptPreferenceUpdate\(state\.preferences,event\.newValue\)/);
  assert.match(app,/preferencesRejected/);
  assert.match(styles,/@media\(max-width:520px\)/);
  assert.match(accessibility,/font-size: 125%/);
  assert.match(accessibility,/\.wallets a/);
  assert.match(accessibility,/min-height: 44px/);
});
