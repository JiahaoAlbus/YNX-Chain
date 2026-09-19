import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve,join} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
const root=resolve(process.argv[2]||fileURLToPath(new URL("../dist",import.meta.url))),checks=[];
for(const variant of["pwa","chromium","firefox"]){
 const dir=join(root,variant),p=await import(pathToFileURL(join(dir,"provider.js")).href),source=await readFile(join(dir,"provider.js")),identity=JSON.parse(await readFile(join(dir,"build-identity.json"),"utf8"));let calls=0;const mm={isMetaMask:true,request(){calls++}},ynx={isYNXWallet:true,providerInfo:{rdns:"com.ynx.wallet"},request(){}};
 assert.equal(p.discoverInjectedProviders({ethereum:mm}).any,undefined);assert.equal(p.discoverInjectedProviders({ethereum:{providers:[mm,ynx]}}).ynx,ynx);assert.equal(p.walletDiscoveryPresentation({metamask:mm,status:"available"}).status,"no-provider");assert.equal(p.walletDiscoveryPresentation({}).showYNXDownload,true);assert.throws(()=>p.createExtensionProvider("metamask",{sendMessage(){calls++}}));await assert.rejects(p.connectStandardWallet(mm,"ynx"));assert.equal(calls,0);
 for(const value of[null,{}, {ynx:"true"}])await assert.rejects(p.extensionWalletAvailability({sendMessage:async()=>value}),{code:"INVALID_DISCOVERY_RESPONSE"});
 await assert.rejects(p.extensionWalletAvailability({sendMessage:async()=>({ynx:false,error:{code:"MIGRATION_INCOMPLETE"}})}),{code:"MIGRATION_INCOMPLETE"});
 checks.push({variant,sourceCommit:identity.sourceCommit,providerSha256:createHash("sha256").update(source).digest("hex"),mixedSelectsYNX:true,otherWalletRequests:0});
}
const evidence={schemaVersion:1,gateClass:"actual built provider modules; simulated injected providers",passed:true,checks,installed:false,providerConnected:false,signed:false,deployed:false};if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(evidence,null,2)+"\n");console.log(JSON.stringify(evidence));
