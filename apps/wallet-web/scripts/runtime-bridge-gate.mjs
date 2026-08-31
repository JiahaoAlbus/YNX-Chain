import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,extname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),extensionPath=join(root,"dist","chromium"),fixtureRoot=join(root,"test","fixtures"),evidenceDir=join(root,"evidence","runtime");
const browserId=process.env.YNX_BROWSER||"edge",gate=process.env.YNX_GATE||"injection",writeEvidence=process.env.YNX_WALLET_WEB_WRITE_EVIDENCE==="1";
const browsers={chrome:{name:"Google Chrome",path:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"},edge:{name:"Microsoft Edge",path:"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"}};
if(!browsers[browserId]||!["injection","accounts","lifecycle","wrong-chain","chain-id","rpc","add-chain","switch-chain","tamper"].includes(gate))throw new Error("Unsupported YNX_BROWSER or YNX_GATE");
const bounded=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error(`${label} timed out after ${ms}ms`),{code:"GATE_TIMEOUT"})),ms))]);
const server=createServer(async(request,response)=>{const url=new URL(request.url||"/","http://ynx.fixture"),relative=url.pathname==="/"?"dapp.html":url.pathname.slice(1),path=resolve(fixtureRoot,relative);if(!path.startsWith(fixtureRoot)){response.writeHead(403).end();return}try{const body=await readFile(path);response.setHeader("content-type",extname(path)===".html"?"text/html":"application/octet-stream");response.end(body)}catch{response.writeHead(404).end()}});
await bounded(new Promise((accept,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",accept)}),3000,"fixture server");
const fixtureUrl=`http://127.0.0.1:${server.address().port}/`,profile=await mkdtemp(join(tmpdir(),`ynx-${browserId}-${gate}-`));let context;
const result={schemaVersion:1,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",generatedAt:new Date().toISOString(),browserId,browserName:browsers[browserId].name,gate,fixtureUrl,loadMode:"temporary-unpacked-isolated-profile",passed:false,installedLocal:false,downloadHosted:false,productionSigned:false,storeReleased:false};
try{
  context=await bounded(chromium.launchPersistentContext(profile,{executablePath:browsers[browserId].path,headless:true,timeout:10000,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]}),12000,"browser launch");
  result.version=context.browser()?.version()||"unknown";
  const worker=await bounded((async()=>{for(let i=0;i<20;i++){const found=context.serviceWorkers()[0];if(found)return found;await new Promise(resolve=>setTimeout(resolve,200))}return context.waitForEvent("serviceworker",{timeout:1000})})(),6000,"service worker");
  result.serviceWorker={started:true,url:worker.url()};
  const page=context.pages()[0]||await context.newPage();await bounded(page.goto(fixtureUrl,{waitUntil:"domcontentloaded",timeout:5000}),6000,"fixture navigation");
  await bounded(page.waitForFunction(()=>Array.isArray(globalThis.ethereum?.providers)&&globalThis.ethereum.providers.some((provider)=>provider?.__ynxCompanion===true),null,{timeout:5000}),6000,"provider injection");
  result.provider=await page.evaluate(()=>{const provider=globalThis.ethereum.providers.find((item)=>item?.__ynxCompanion===true);return{injected:Boolean(provider),isYNXWallet:provider?.isYNXWallet===true,rdns:provider?.providerInfo?.rdns,requestType:typeof provider?.request}});
  if(gate==="injection")result.passed=result.provider.injected&&result.provider.isYNXWallet&&result.provider.rdns==="com.ynx.wallet"&&result.provider.requestType==="function";
  if(gate==="accounts"){
    result.outcome=await bounded(page.evaluate(async()=>{const provider=globalThis.ethereum.providers.find((item)=>item?.__ynxCompanion===true);return{passive:await provider.request({method:"eth_accounts"}),requested:await provider.request({method:"eth_requestAccounts"}),calls:globalThis.__YNX_FIXTURE_CALLS__}}),6000,"accounts bridge");
    result.passed=result.outcome.passive?.[0]==="0x1111111111111111111111111111111111111111"&&result.outcome.requested?.[0]===result.outcome.passive[0]&&result.outcome.calls.some((call)=>call.provider==="ynx");
  }
  if(gate==="lifecycle"){
    result.outcome=await bounded(page.evaluate(async()=>{const provider=globalThis.ethereum.providers.find((item)=>item?.__ynxCompanion===true),events=[];provider.on("accountsChanged",(value)=>events.push(["accountsChanged",value]));provider.on("disconnect",(value)=>events.push(["disconnect",value]));const first=await provider.request({method:"eth_requestAccounts"});await provider.disconnect();const second=await provider.request({method:"eth_requestAccounts"});await new Promise(resolve=>setTimeout(resolve,50));return{first,second,events}}),7000,"lifecycle bridge");
    result.passed=result.outcome.first?.[0]===result.outcome.second?.[0]&&result.outcome.events.some(([event])=>event==="disconnect")&&result.outcome.events.some(([event,value])=>event==="accountsChanged"&&Array.isArray(value)&&value.length===0);
  }
  if(gate==="wrong-chain"){
    result.outcome=await bounded(page.evaluate(async()=>{const provider=globalThis.ethereum.providers.find((item)=>item?.__ynxCompanion===true);globalThis.__YNX_FIXTURE_SET_CHAIN__("0x1");globalThis.__YNX_FIXTURE_SET_SWITCH_APPLIES__(false);try{await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x1917"}]});return{success:true}}catch(error){return{success:false,error:{code:error?.code,message:error?.message},calls:globalThis.__YNX_FIXTURE_CALLS__}}}),20000,"wrong-chain bridge");
    result.passed=result.outcome.success===false&&result.outcome.error?.code==="WRONG_NETWORK";
  }
  if(gate==="chain-id"||gate==="rpc"){
    result.outcome=await bounded(page.evaluate(async()=>{const provider=globalThis.ethereum.providers.find((item)=>item?.__ynxCompanion===true);try{return{success:true,result:await provider.request({method:"eth_chainId"})}}catch(error){return{success:false,error:{code:error?.code,message:error?.message}}}}),20000,"chain-id bridge");
    result.passed=result.outcome.success===true&&result.outcome.result==="0x1917";
  }
  if(gate==="add-chain"||gate==="switch-chain"){
    result.outcome=await bounded(page.evaluate(async(gateName)=>{const provider=globalThis.ethereum.providers.find((item)=>item?.__ynxCompanion===true),method=gateName==="add-chain"?"wallet_addEthereumChain":"wallet_switchEthereumChain",params=gateName==="add-chain"?[{chainId:"0x1917",chainName:"YNX Testnet",nativeCurrency:{name:"YNX Testnet",symbol:"YNXT",decimals:18},rpcUrls:["https://evm.ynxweb4.com"],blockExplorerUrls:["https://explorer.ynxweb4.com"]}]:[{chainId:"0x1917"}];try{await provider.request({method,params});return{success:true,chainId:await provider.request({method:"eth_chainId"}),calls:globalThis.__YNX_FIXTURE_CALLS__}}catch(error){return{success:false,error:{code:error?.code,message:error?.message},calls:globalThis.__YNX_FIXTURE_CALLS__}}},gate),20000,`${gate} bridge`);
    result.passed=result.outcome.success===true&&result.outcome.chainId==="0x1917"&&result.outcome.calls.some((call)=>call.method===(gate==="add-chain"?"wallet_addEthereumChain":"wallet_switchEthereumChain"));
  }
  if(gate==="tamper"){
    result.outcome=await bounded(page.evaluate(async()=>{const provider=globalThis.ethereum.providers.find((item)=>item?.__ynxCompanion===true);try{await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x1"}]});return{success:true,calls:globalThis.__YNX_FIXTURE_CALLS__}}catch(error){return{success:false,error:{code:error?.code,message:error?.message},calls:globalThis.__YNX_FIXTURE_CALLS__}}}),6000,"tampered chain params");
    result.passed=result.outcome.success===false&&result.outcome.error?.code==="INVALID_CHAIN_PARAMS"&&!result.outcome.calls.some((call)=>call.method==="wallet_switchEthereumChain"||call.method==="wallet_addEthereumChain");
  }
}catch(error){result.error={name:error?.name||"Error",code:error?.code||null,message:error?.message||String(error)};}
finally{if(context)await bounded(context.close(),3000,"browser close").catch(()=>{});server.close();await rm(profile,{recursive:true,force:true}).catch(()=>{});}
const artifact=await readFile(join(root,"artifacts","ynx-wallet-chrome-edge-0.1.0.zip"));result.artifact={bytes:artifact.length,sha256:createHash("sha256").update(artifact).digest("hex")};
if(writeEvidence){await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,`branded-${browserId}-${gate}.json`),`${JSON.stringify(result,null,2)}\n`)}
console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);
