import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFile,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {deriveCoreWalletAuthBinding} from "../src/core-auth-consumer.js";
import {canonicalYNXAuthorizationState,metaMaskMobileDappUrl} from "../src/mobile-wallet-routing.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const repository=resolve(root,"..","..");
const registry=JSON.parse(await readFile(resolve(repository,"packages/wallet-auth/central-registry.json"),"utf8"));
const binding=deriveCoreWalletAuthBinding(registry);
const ynxAuth=canonicalYNXAuthorizationState(binding);
const artifacts=["ynx-wallet-web-pwa-0.1.0.zip","ynx-wallet-chrome-edge-0.1.0.zip","ynx-wallet-firefox-0.1.0.zip"];
const checks=[];
for(const artifact of artifacts){
  const path=resolve(root,"artifacts",artifact);
  const files=execFileSync("unzip",["-Z1",path],{encoding:"utf8"}).trim().split("\n");
  assert(files.includes("mobile-wallet-routing.js"));
  assert(files.includes("core-auth-binding.js"));
  const routing=execFileSync("unzip",["-p",path,"mobile-wallet-routing.js"],{encoding:"utf8"});
  const app=execFileSync("unzip",["-p",path,"app.js"],{encoding:"utf8"});
  const frozen=execFileSync("unzip",["-p",path,"core-auth-binding.js"],{encoding:"utf8"});
  assert.match(routing,/canonical-auth-unavailable/);
  assert.match(routing,/https:\/\/metamask\.app\.link/);
  assert.doesNotMatch(app,/ynxwallet:\/\/open/);
  assert.match(app,/CANONICAL_AUTH_UNAVAILABLE/);
  assert.doesNotMatch(app,/handleMobileWalletReturn|pageshow|visibilitychange/);
  assert.match(frozen,/"enabled":false/);
  assert.match(frozen,/"webCallbacks":\[\]/);
  checks.push({artifact,mobileRoutingPresent:true,coreBindingPresent:true,ynxLauncherMisrepresentedAsConnect:false});
}
assert.deepEqual(ynxAuth,{route:"canonical-auth-unavailable",available:false,callback:null,error:"CANONICAL_AUTH_UNAVAILABLE"});
assert.equal(metaMaskMobileDappUrl(),"https://metamask.app.link/dapp/www.ynxweb4.com/dapp/wallet");
const evidence={schemaVersion:1,generatedAt:new Date().toISOString(),immutableCentralDependency:{commit:"d0f89797d13c7667cc187b0c64d5c9e1cb1d8f59",endpointMatrix:{blob:"d402fcdc844aa39bd5ee351a99d93acb4852dc37",sha256:"d344c607c2bbbf7bb0d9d3662b424976d0d6c4ff20428025dd1e2fb92bf31392"},androidLauncher:{blob:"83c9f91779701288861cff5e4dc6c487ffcdc26c",sha256:"d296732141a4029b1811b655f0001cc7d81a1d45019a4bd87d21b2b4b256d1a6"}},coreBinding:binding,ynxAuthorization:ynxAuth,metaMaskMobileDappUrl:metaMaskMobileDappUrl(),checks,gates:{injectedProviderConnectProvedBySource:true,externalChromeReturnTreatedAsProviderSuccess:false,ynxCanonicalAuthorizationAvailable:false,metaMaskMobileRouteProvedByBuiltArtifacts:true,providerConnected:false,account:false,sign:false,transaction:false,testnetConnected:false,deployedPublic:false}};
await writeFile(resolve(root,"evidence/runtime/mobile-wallet-routing-built-gate-20260815.json"),`${JSON.stringify(evidence,null,2)}\n`);
console.log(JSON.stringify(evidence,null,2));
