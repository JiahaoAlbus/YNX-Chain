import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const firefox=process.env.YNX_FIREFOX_COMPATIBLE_BINARY||join(homedir(),"Library/Caches/ms-playwright/firefox-1538/firefox/Nightly.app/Contents/MacOS/firefox");
const webExt=join(root,"node_modules/.bin/web-ext"),source=join(root,"dist/firefox"),evidenceDir=join(root,"evidence/runtime");
const keepEvidence=process.env.YNX_WALLET_WEB_WRITE_EVIDENCE==="1",sourceCommit=process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree";
let output="",temporaryAddonLoaded=false,timedOut=false;

const child=spawn(webExt,["run","--source-dir",source,"--firefox",firefox,"--no-reload","--no-input","--args=-headless","--verbose"],{cwd:root,stdio:["ignore","pipe","pipe"]});
const consume=(chunk)=>{
  output+=chunk.toString();
  if(!temporaryAddonLoaded&&output.includes("as a temporary add-on")){temporaryAddonLoaded=true;setTimeout(()=>child.kill("SIGINT"),750)}
};
child.stdout.on("data",consume);child.stderr.on("data",consume);
const timer=setTimeout(()=>{timedOut=true;child.kill("SIGINT")},90000);
const exit=await new Promise(resolve=>child.once("exit",(code,signal)=>resolve({code,signal})));clearTimeout(timer);
const artifact=await readFile(join(root,"artifacts/ynx-wallet-firefox-0.1.0.zip"));
const versionMatch=output.match(/Firefox 153\.0/u);
const evidence={
  schemaVersion:1,sourceCommit,generatedAt:new Date().toISOString(),
  runtime:{name:"Playwright patched Firefox",version:versionMatch?.[0]?.replace("Firefox ","")||"153.0",brandedMozillaFirefox:false,executablePath:firefox},
  loader:{name:"web-ext",version:"10.6.0",loadMode:"temporary-addon-isolated-profile",addonId:"wallet-testnet@ynxweb4.com",temporaryAddonLoaded,timedOut,exit},
  coverage:{manifestValidated:output.includes("Validating manifest"),debuggerConnected:output.includes("Connected to the remote Firefox debugger"),backgroundStarted:false,dappMainWorldInjectionTested:false,rpcFailClosedTested:false,secondLaunchPersisted:false},
  artifact:{name:"ynx-wallet-firefox-0.1.0.zip",bytes:artifact.length,sha256:createHash("sha256").update(artifact).digest("hex"),signingClass:"unsigned-unpacked-extension"},
  releaseStates:{firefoxCompatibleTemporaryRuntime:temporaryAddonLoaded,firefoxBrandedRuntime:false,installedLocal:false,downloadHosted:false,productionSigned:false,storeReleased:false}
};
if(keepEvidence){await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,"firefox-compatible-web-ext-output.txt"),output);await writeFile(join(evidenceDir,"firefox-compatible-temporary-runtime.json"),`${JSON.stringify(evidence,null,2)}\n`)}
console.log(JSON.stringify(evidence,null,2));if(!temporaryAddonLoaded)process.exitCode=1;
