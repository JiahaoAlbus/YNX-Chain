import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {webCustomSchemeLauncherDisabled} from "./ynxWalletLauncher";

test("Web custom-scheme launcher is disabled",()=>{assert.equal(webCustomSchemeLauncherDisabled(),"unavailable");});
test("Card fallback and MetaMask handlers do not launch YNX custom schemes on Web",()=>{const root=new URL("./",import.meta.url),app=readFileSync(new URL("../App.tsx",root),"utf8"),guest=readFileSync(new URL("GuestExperience.tsx",root),"utf8"),launcher=readFileSync(new URL("ynxWalletLauncher.ts",root),"utf8");assert.doesNotMatch(app,/launchYNXWalletRequest|iframe|window\.open/);assert.match(guest,/Retry YNX Wallet/);assert.match(guest,/https:\/\/wallet\.ynxweb4\.com\//);assert.doesNotMatch(guest.slice(guest.indexOf("MetaMask")),/ynxwallet:\/\/authorize/);assert.doesNotMatch(launcher,/iframe|window\.open|ynxwallet:/);});
