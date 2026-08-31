import {execFile,spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {chromium} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),extensionPath=join(root,"dist","chromium"),evidenceDir=join(root,"evidence","runtime");
const browserId=process.env.YNX_BROWSER||"chrome",launchMode=process.env.YNX_BRANDED_LAUNCH||"direct",headed=process.env.YNX_BRANDED_HEADED==="1",sourceCommit=process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",writeEvidence=process.env.YNX_WALLET_WEB_WRITE_EVIDENCE==="1";
const browsers={chrome:{name:"Google Chrome",app:"/Applications/Google Chrome.app",path:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",extensionsUrl:"chrome://extensions"},edge:{name:"Microsoft Edge",app:"/Applications/Microsoft Edge.app",path:"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",extensionsUrl:"edge://extensions"}};
if(!browsers[browserId]||!["direct","open-new"].includes(launchMode))throw new Error("YNX_BROWSER must be chrome or edge and YNX_BRANDED_LAUNCH must be direct or open-new");
const browserSpec=browsers[browserId],bounded=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error(`${label} timed out after ${ms}ms`),{code:"GATE_TIMEOUT"})),ms))]);
const delay=(ms)=>new Promise(resolveDelay=>setTimeout(resolveDelay,ms));
const execFileAsync=promisify(execFile);
const extensionId=[...createHash("sha256").update(extensionPath).digest("hex").slice(0,32)].map(value=>String.fromCharCode(97+Number.parseInt(value,16))).join("");
const profile=await mkdtemp(join(tmpdir(),`ynx-wallet-${browserId}-cdp-`)),stderr=[];
const artifact=await readFile(join(root,"artifacts","ynx-wallet-chrome-edge-0.1.0.zip"));
const result={schemaVersion:1,sourceCommit,generatedAt:new Date().toISOString(),browserId,browserName:browserSpec.name,executablePath:browserSpec.path,browserVersion:null,loadMode:"temporary-unpacked-isolated-profile",launchMode,profileClass:"disposable-isolated-profile-reused-only-for-second-launch",runtimePresentation:`${headed?"headed":"headless-new"} branded binary automation; not installedLocal evidence`,extension:{path:extensionPath,derivedId:extensionId,actualId:null},artifact:{name:"ynx-wallet-chrome-edge-0.1.0.zip",bytes:artifact.length,sha256:createHash("sha256").update(artifact).digest("hex"),signingClass:"unsigned-unpacked-extension"},launchArgs:{removedDisableExtensions:true,headlessNew:!headed,gpuDisabled:true,remoteAllowOrigins:true,remoteDebuggingPort:"ephemeral",dailyProfileTouched:false},launches:[],passed:false,temporaryUnpackedRuntimeProved:false,firstOpenProved:false,secondOpenProved:false,serviceWorkerRestartProved:false,visibleBrowserAcceptance:false,installedLocal:false,providerSuccessClaimed:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false,downloadHosted:false,deployedPublic:false,productionSigned:false,storeReleased:false};

function alive(pid){try{process.kill(pid,0);return true}catch{return false}}
async function stopProcess(child){
  if(!child?.pid||!alive(child.pid))return;try{process.kill(-child.pid,"SIGTERM")}catch{}
  for(let attempt=0;attempt<10&&alive(child.pid);attempt++)await delay(100);
  if(alive(child.pid))try{process.kill(-child.pid,"SIGKILL")}catch{}
  for(let attempt=0;attempt<10&&alive(child.pid);attempt++)await delay(100);
}
async function profilePids(){
  const {stdout}=await execFileAsync("/bin/ps",["-axo","pid=,command="],{maxBuffer:2_000_000});const marker=`--user-data-dir=${profile}`;
  return String(stdout).split("\n").filter(line=>line.includes(marker)).map(line=>Number.parseInt(line.trim().split(/\s+/u,1)[0],10)).filter(Number.isInteger);
}
async function waitForProfilePid(){for(let attempt=0;attempt<100;attempt++){const pids=await profilePids();if(pids.length)return pids[0];await delay(100)}throw Object.assign(new Error("macOS open -n created no exact isolated-profile browser process within 10000ms"),{code:"PROFILE_PROCESS_TIMEOUT"})}
async function stopProfileProcesses(){
  const initial=await profilePids();for(const pid of initial)try{process.kill(pid,"SIGTERM")}catch{}
  for(let attempt=0;attempt<10&&(await profilePids()).length;attempt++)await delay(100);
  const remaining=await profilePids();for(const pid of remaining)try{process.kill(pid,"SIGKILL")}catch{}
  for(let attempt=0;attempt<10&&(await profilePids()).length;attempt++)await delay(100);return{initial,remainingAfterTerm:remaining,aliveAfterCleanup:await profilePids()};
}
async function devtoolsEndpoint(){
  const file=join(profile,"DevToolsActivePort");
  for(let attempt=0;attempt<100;attempt++){try{const [port,path]=String(await readFile(file)).trim().split(/\r?\n/u);if(/^\d+$/u.test(port)&&path?.startsWith("/devtools/browser/"))return `ws://127.0.0.1:${port}${path}`}catch{}await delay(100)}
  throw Object.assign(new Error("DevToolsActivePort was not created within 10000ms"),{code:"CDP_ENDPOINT_TIMEOUT"});
}
async function inspectManager(page){
  await bounded(page.goto(browserSpec.extensionsUrl,{waitUntil:"domcontentloaded",timeout:5000}),6000,"extensions manager");
  await bounded(page.waitForFunction(()=>{const manager=document.querySelector("extensions-manager"),list=manager?.shadowRoot?.querySelector("extensions-item-list");return Boolean(list?.shadowRoot)},null,{timeout:5000}),6000,"extensions manager entry list");
  return page.evaluate(()=>{const manager=document.querySelector("extensions-manager"),list=manager?.shadowRoot?.querySelector("extensions-item-list"),items=[...(list?.shadowRoot?.querySelectorAll("extensions-item")||[])];return items.map(item=>({id:item.id||item.getAttribute("id")||item.data?.id||null,name:item.data?.name||null,enabled:item.data?.state===1||item.data?.enabled===true,location:item.data?.location??null}))});
}
async function launchOnce(sequence){
  await rm(join(profile,"DevToolsActivePort"),{force:true});
  const args=[`--user-data-dir=${profile}`,...(headed?[]:["--headless=new"]),"--disable-gpu","--remote-allow-origins=*","--remote-debugging-port=0","--no-first-run","--no-default-browser-check",`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,"about:blank"],startedAt=new Date().toISOString();let child;
  const launch={sequence,startedAt,pid:null,pidAliveAtStart:false,launcherExit:null,childExit:null,cdpConnected:false,managerEntries:[],popupOpened:false,serviceWorkerStarted:false,backgroundTargets:[],console:[],runtimeWake:null,endedPidAlive:null,cleanup:null};let browser;
  try{
    if(launchMode==="direct"){
      child=spawn(browserSpec.path,args,{detached:true,stdio:["ignore","ignore","pipe"]});launch.pid=child.pid;launch.pidAliveAtStart=alive(child.pid);child.once("exit",(code,signal)=>{launch.childExit={code,signal}});child.stderr.setEncoding("utf8");child.stderr.on("data",chunk=>{if(stderr.join("").length<12000)stderr.push(String(chunk))});
    }else{
      const opener=spawn("/usr/bin/open",["-n",browserSpec.app,"--args",...args],{stdio:["ignore","ignore","pipe"]});opener.stderr.setEncoding("utf8");opener.stderr.on("data",chunk=>stderr.push(String(chunk)));launch.launcherExit=await bounded(new Promise(resolveExit=>opener.once("exit",(code,signal)=>resolveExit({code,signal}))),5000,"macOS open -n");if(launch.launcherExit.code!==0)throw new Error(`macOS open -n exited ${launch.launcherExit.code}`);launch.pid=await bounded(waitForProfilePid(),11000,"isolated browser process");launch.pidAliveAtStart=alive(launch.pid);
    }
    const endpoint=await bounded(devtoolsEndpoint(),11000,"CDP endpoint");launch.cdpEndpoint=endpoint.replace(/\/devtools\/browser\/.+$/u,"/devtools/browser/<redacted>");browser=await bounded(chromium.connectOverCDP(endpoint,{timeout:5000}),6000,"CDP connect");launch.cdpConnected=true;launch.browserVersion=browser.version();result.browserVersion=launch.browserVersion;
    const context=browser.contexts()[0];if(!context)throw new Error("CDP browser exposed no persistent context");
    const manager=await context.newPage();launch.managerEntries=await bounded(inspectManager(manager),7000,"extension manager inspection");await manager.close();
    const extensionEntry=launch.managerEntries.find((entry)=>entry.name==="YNX Wallet"&&typeof entry.id==="string"&&entry.id.length>0);
    if(!extensionEntry)throw Object.assign(new Error("Chrome did not load the YNX Wallet command-line extension into this disposable profile."),{code:"COMMAND_LINE_EXTENSION_NOT_LOADED"});
    const extensionId=extensionEntry.id;launch.extensionId=extensionId;result.extension.actualId=extensionId;
    const popup=await context.newPage();popup.on("console",message=>launch.console.push({source:"popup",type:message.type(),text:message.text()}));
    const popupUrl=`chrome-extension://${extensionId}/index.html`;await bounded(popup.goto(popupUrl,{waitUntil:"domcontentloaded",timeout:5000}),6000,"popup open");launch.popupOpened=popup.url()===popupUrl;
    let worker=context.serviceWorkers().find(item=>item.url().startsWith(`chrome-extension://${extensionId}/`));if(!worker){worker=await bounded(context.waitForEvent("serviceworker",{predicate:item=>item.url().startsWith(`chrome-extension://${extensionId}/`),timeout:5000}),6000,"service worker wake")}
    worker.on("console",message=>launch.console.push({source:"service-worker",type:message.type(),text:message.text()}));launch.serviceWorkerStarted=true;launch.serviceWorkerUrl=worker.url();result.extension.actualId=new URL(worker.url()).host;
    launch.runtimeWake=await bounded(popup.evaluate(async()=>{try{return{response:await chrome.runtime.sendMessage({type:"YNX_WALLET_DISCOVER"}),lastError:chrome.runtime.lastError?.message||null}}catch(error){return{error:{name:error?.name||"Error",message:error?.message||String(error)}}}}),6000,"runtime wake event");
    launch.backgroundTargets=[...context.serviceWorkers(),...context.pages()].filter(target=>target.url().startsWith(`chrome-extension://${extensionId}/`)).map(target=>({type:typeof target.evaluate==="function"&&target===worker?"service_worker":"page",url:target.url()}));
    await popup.close();launch.completed=true;
  }catch(error){launch.error={name:error?.name||"Error",code:error?.code||null,message:error?.message||String(error)};}
  finally{if(browser)await bounded(browser.close(),3000,"CDP disconnect").catch(()=>{});if(launchMode==="direct"){await stopProcess(child);launch.endedPidAlive=child?.pid?alive(child.pid):false}else{launch.cleanup=await stopProfileProcesses();launch.endedPidAlive=launch.pid?alive(launch.pid):false}launch.endedAt=new Date().toISOString();}
  return launch;
}

try{
  result.launches.push(await launchOnce(1));result.launches.push(await launchOnce(2));
  const[first,second]=result.launches;result.firstOpenProved=first.popupOpened&&first.serviceWorkerStarted&&first.endedPidAlive===false;result.secondOpenProved=second.popupOpened&&second.serviceWorkerStarted&&second.endedPidAlive===false;result.serviceWorkerRestartProved=result.firstOpenProved&&result.secondOpenProved&&first.pid!==second.pid&&first.serviceWorkerUrl===second.serviceWorkerUrl;result.temporaryUnpackedRuntimeProved=result.firstOpenProved&&result.secondOpenProved&&result.serviceWorkerRestartProved&&result.extension.actualId===extensionId;result.passed=result.temporaryUnpackedRuntimeProved;
}finally{result.stderr=stderr.join("").slice(0,12000);await rm(profile,{recursive:true,force:true}).catch(()=>{});}
if(writeEvidence){await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,`branded-${browserId}-cdp-lifecycle-20260814.json`),`${JSON.stringify(result,null,2)}\n`)}
console.log(JSON.stringify(result,null,2));await new Promise(resolveWrite=>process.stdout.write("",resolveWrite));process.exit(result.passed?0:1);
