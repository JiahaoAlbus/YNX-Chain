import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve,join} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
const root=resolve(process.argv[2]||fileURLToPath(new URL("../dist",import.meta.url))),checks=[];
for(const variant of["pwa","chromium","firefox"]){
 const dir=join(root,variant),routing=await import(pathToFileURL(join(dir,"mobile-wallet-routing.js")).href),app=await readFile(join(dir,"app.js"),"utf8"),source=await readFile(join(dir,"mobile-wallet-routing.js"),"utf8"),identity=JSON.parse(await readFile(join(dir,"build-identity.json"),"utf8"));
 assert.equal(routing.metaMaskMobileDappUrl,undefined);assert.equal(routing.mobileWalletPresentation({metamask:true},true).ynxRoute,"canonical-auth-unavailable");assert.equal(routing.mobileWalletPresentation({ynx:true},true).ynxRoute,"injected-provider");assert.doesNotMatch(source+app,/metamask/iu);
 checks.push({variant,sourceCommit:identity.sourceCommit,routingSha256:createHash("sha256").update(source).digest("hex"),appSha256:createHash("sha256").update(app).digest("hex"),ynxOnly:true});
}
const evidence={schemaVersion:1,gateClass:"actual built mobile routing and UI modules",passed:true,checks,installed:false,providerConnected:false,signed:false,deployed:false};if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(evidence,null,2)+"\n");console.log(JSON.stringify(evidence));
