import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root=new URL("../../../",import.meta.url);
const baselineURL=new URL("../proof/wallet-auth-caller-migration-baseline.json",import.meta.url);
const executable=/\.(?:cjs|cs|java|js|jsx|mjs|swift|ts|tsx)$/;
const excluded=/(?:^|\/)(?:build|dist|node_modules|proof|scripts|test|tests)(?:\/|$)|\.test\.|packages\/wallet-auth\/src\/deep-link\.js$/;
const tracked=spawnSync("git",["ls-files","-z","apps","packages"],{cwd:root,encoding:"utf8"});
assert.equal(tracked.status,0,"wallet-auth caller migration verifier requires a readable Git index");

const findings=[];
for(const path of tracked.stdout.split("\0").filter(Boolean).filter((path)=>executable.test(path)&&!excluded.test(path)).sort()){
  const source=await readFile(new URL(path,root),"utf8");
  if(/ynx-wallet:\/\//.test(source))findings.push({path,kind:"forbidden-legacy-scheme"});
  if(/ynxwallet:\/\/(?:sign-app-session|authorize\?challenge)/.test(source))findings.push({path,kind:"forbidden-legacy-route"});
  if(/ynxwallet:\/\/authorize\?request=/.test(source)&&!/encodeRequestDeepLink/.test(source))findings.push({path,kind:"manual-authorize-uri-construction"});
}

findings.sort((left,right)=>left.path.localeCompare(right.path)||left.kind.localeCompare(right.kind));
const strict=process.argv.includes("--strict");
if(strict){
  assert.deepEqual(findings,[],`all release callers must use @ynx-chain/wallet-auth encodeRequestDeepLink; migration blockers:\n${findings.map((item)=>`${item.kind} ${item.path}`).join("\n")}`);
}else{
  const baseline=JSON.parse(await readFile(baselineURL,"utf8"));
  assert.equal(baseline.schemaVersion,1);
  assert.equal(baseline.accepted,false,"migration baseline cannot claim cross-ecosystem acceptance");
  assert.equal(baseline.callbackRewriteAuthorized,false,"caller migration must not silently rewrite product callbacks");
  assert.deepEqual(findings,baseline.findings,"wallet-auth caller debt changed; fix the owner source and deliberately update the false baseline");
}
console.log(`wallet-auth caller migration ${strict?"strict":"ratchet"} passed: blockers=${findings.length} accepted=${findings.length===0}`);
