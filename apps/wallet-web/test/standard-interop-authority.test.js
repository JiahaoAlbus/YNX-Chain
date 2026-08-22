import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const repository=resolve(dirname(fileURLToPath(import.meta.url)),"..","..","..");
const commit="9ab9cd8c8deac8563acff9ffd7e277553e20383e";
const path="release/integration/wallet-standard-connection-conformance-contract-p0-20260822.json";
const blob="173cb99a6fa6b942f43c6dc8ee3a3b851e876525";
const sha256="c59cc18de86a304be8de6ef7056e3e260e62156fe36fb0b76e021e38e096a2fe";

test("build consumes the exact Router Standard EVM interop authority",async()=>{
  assert.equal(execFileSync("git",["rev-parse",`${commit}:${path}`],{cwd:repository,encoding:"utf8"}).trim(),blob);
  const bytes=execFileSync("git",["show",`${commit}:${path}`],{cwd:repository});
  assert.equal(createHash("sha256").update(bytes).digest("hex"),sha256);
  const source=await readFile(new URL("../scripts/build.mjs",import.meta.url),"utf8");
  for(const value of[commit,path,blob,sha256])assert.match(source,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});

test("interop authority keeps installed-browser promotion strict",()=>{
  const contract=JSON.parse(execFileSync("git",["show",`${commit}:${path}`],{cwd:repository,encoding:"utf8"}));
  assert.deepEqual(contract.chain,{cosmosChainId:"ynx_6423-1",evmChainId:6423,evmChainHex:"0x1917",nativeSymbol:"YNXT",defaultLanguage:"en"});
  assert.equal(contract.layering.directBrowserRpcFetchIsPrerequisite,false);
  assert.deepEqual(contract.layering.productSessionFailure,{standardConnection:"CONNECTED",privateService:"DEGRADED",fabricatedSession:false});
  assert.equal(contract.executableInteropFixture.fixtureOnly,true);
  assert.deepEqual(contract.executableInteropFixture.profiles,["ynx-first-party","uniswap-interface-reference","opensea-reference","safe-reference","walletconnect-v2-reference"]);
  assert.ok(contract.requiredDirectEvidenceBeforePromotion.includes("three independently opened non-YNX standard EVM DApps plus a first-party DApp"));
});
