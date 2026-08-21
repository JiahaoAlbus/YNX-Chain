import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {webCustomSchemeLauncherDisabled} from "./ynxWalletLauncher";

test("Web custom-scheme launcher is disabled",()=>{assert.equal(webCustomSchemeLauncherDisabled(),"unavailable");});
test("Card Web source has no custom-scheme launcher and keeps visible fallback paths",()=>{const root=new URL("./",import.meta.url),app=readFileSync(new URL("../App.tsx",root),"utf8"),guest=readFileSync(new URL("GuestExperience.tsx",root),"utf8"),launcher=readFileSync(new URL("ynxWalletLauncher.ts",root),"utf8"),runtime=readFileSync(new URL("productWalletRuntime.ts",root),"utf8"),worker=readFileSync(new URL("../public/sw.js",root),"utf8");for(const source of [app,launcher,runtime])assert.doesNotMatch(source,/ynxwallet:\/\/authorize|launchYNXWalletRequest|iframe|window\.open|location\.(assign|href)|Linking\.openURL/);assert.match(app,/discoverWalletProviders/);assert.match(app,/resolveSharedProvider\("ynx-wallet"\)/);assert.match(guest,/Retry YNX Wallet/);assert.match(guest,/https:\/\/wallet\.ynxweb4\.com\//);assert.doesNotMatch(guest.slice(guest.indexOf("MetaMask")),/ynxwallet:\/\/authorize/);assert.match(runtime,/SAFE_LAUNCHER_UNAVAILABLE/);assert.match(worker,/simulation-v2/);assert.doesNotMatch(worker,/cache\.put|caches\.match/);});
