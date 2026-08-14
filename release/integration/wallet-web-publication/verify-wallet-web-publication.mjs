import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here=dirname(fileURLToPath(import.meta.url)),repoRoot=resolve(here,"../../..");
const acquisition=JSON.parse(await readFile(join(here,"artifact-acquisition.json"),"utf8"));
const evidencePath=join(repoRoot,"apps/wallet-web/evidence/runtime/wallet-web-publication-three-origin-gate-20260814.json");
const origins=[{origin:"https://www.ynxweb4.com",walletPath:"/dapp/wallet"},{origin:"https://ynxweb4.com",walletPath:"/dapp/wallet"},{origin:"https://wallet.ynxweb4.com",walletPath:"/"}];
const sha256=(body)=>createHash("sha256").update(body).digest("hex");
const isTransportError=(error)=>["TypeError","AbortError","TimeoutError"].includes(error?.name)||String(error?.code||"").startsWith("UND_ERR_");
async function fetchWithTransportRetry(fetcher,url,{timeoutMs,onAttempt}){
  let lastError;for(let attempt=1;attempt<=3;attempt++){onAttempt(attempt);try{return await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(timeoutMs)})}catch(error){lastError=error;if(!isTransportError(error)||attempt===3)throw error;await new Promise(resolveDelay=>setTimeout(resolveDelay,attempt*250))}}
  throw lastError;
}

async function artifactCheck(fetcher,origin,artifact){
  const url=`${origin}${artifact.officialPath}`,record={origin,name:artifact.name,url,attempts:0,status:null,contentType:null,contentDisposition:null,contentLength:null,downloadedBytes:null,downloadedSha256:null,passed:false,error:null};
  try{
    const response=await fetchWithTransportRetry(fetcher,url,{timeoutMs:15000,onAttempt:attempt=>{record.attempts=attempt}});record.status=response.status;record.contentType=response.headers.get("content-type");record.contentDisposition=response.headers.get("content-disposition");const length=response.headers.get("content-length");record.contentLength=length===null?null:Number(length);
    if((response.url||url)!==url)throw new Error("redirected");if(response.status!==200)throw new Error("status");if(record.contentType?.split(";",1)[0].trim().toLowerCase()!=="application/zip")throw new Error("content-type");if(!/^attachment(?:;|$)/iu.test(record.contentDisposition||""))throw new Error("content-disposition");if(record.contentLength!==artifact.bytes)throw new Error("content-length");
    const body=Buffer.from(await response.arrayBuffer());record.downloadedBytes=body.length;record.downloadedSha256=sha256(body);if(body.length!==artifact.bytes)throw new Error("bytes");if(record.downloadedSha256!==artifact.sha256)throw new Error("sha256");record.passed=true;
  }catch(error){record.error=error?.message||String(error)}return record;
}

async function pageCheck(fetcher,target){
  const url=`${target.origin}${target.walletPath}`,record={url,attempts:0,status:null,contentType:null,passed:false,error:null};try{const response=await fetchWithTransportRetry(fetcher,url,{timeoutMs:10000,onAttempt:attempt=>{record.attempts=attempt}});record.status=response.status;record.contentType=response.headers.get("content-type");if((response.url||url)!==url)throw new Error("redirected");if(response.status!==200)throw new Error("status");if(record.contentType?.split(";",1)[0].trim().toLowerCase()!=="text/html")throw new Error("content-type");record.passed=true}catch(error){record.error=error?.message||String(error)}return record;
}

async function registryCheck(fetcher){
  const url="https://www.ynxweb4.com/releases/ecosystem-release-registry.json",record={url,attempts:0,status:null,sourceCommit:null,downloads:[],passed:false,error:null};try{const response=await fetchWithTransportRetry(fetcher,url,{timeoutMs:10000,onAttempt:attempt=>{record.attempts=attempt}});record.status=response.status;if((response.url||url)!==url||response.status!==200)throw new Error("registry-response");const registry=await response.json(),wallet=registry?.products?.find(item=>item?.key==="wallet");record.sourceCommit=wallet?.commit||null;record.downloads=wallet?.downloads||[];if(record.sourceCommit!==acquisition.sourceCommit)throw new Error("registry-source-commit");for(const artifact of acquisition.artifacts){const expectedUrl=`https://www.ynxweb4.com${artifact.officialPath}`,entry=record.downloads.find(item=>item?.url===expectedUrl);if(!entry||entry.sha256!==artifact.sha256||entry.bytes!==artifact.bytes||entry.hosted!==true)throw new Error(`registry-artifact-${artifact.platform}`)}record.passed=true}catch(error){record.error=error?.message||String(error)}return record;
}

async function run(fetcher=fetch){
  const [pages,artifacts,registry]=await Promise.all([Promise.all(origins.map(target=>pageCheck(fetcher,target))),Promise.all(origins.flatMap(target=>acquisition.artifacts.map(artifact=>artifactCheck(fetcher,target.origin,artifact)))),registryCheck(fetcher)]);return{pages,artifacts,registry,passed:pages.every(item=>item.passed)&&artifacts.every(item=>item.passed)&&registry.passed};
}

async function selfTest(){
  const bodies=new Map(acquisition.artifacts.map(artifact=>[artifact.name,execFileSync("git",["show",`${acquisition.artifactCarrierCommit}:${artifact.gitPath}`],{maxBuffer:2_000_000})]));
  const registry={products:[{key:"wallet",commit:acquisition.sourceCommit,downloads:acquisition.artifacts.map(artifact=>({url:`https://www.ynxweb4.com${artifact.officialPath}`,sha256:artifact.sha256,bytes:artifact.bytes,hosted:true}))}]};
  const calls=new Map(),retryTarget=`https://www.ynxweb4.com${acquisition.artifacts.find(item=>item.platform==="firefox").officialPath}`;
  const fakeFetch=async(url)=>{calls.set(url,(calls.get(url)||0)+1);if(url===retryTarget&&calls.get(url)===1)throw new TypeError("simulated transient transport failure");if(url.endsWith("/releases/ecosystem-release-registry.json"))return new Response(JSON.stringify(registry),{status:200,headers:{"content-type":"application/json"}});const artifact=acquisition.artifacts.find(item=>url.endsWith(item.officialPath));if(artifact){const body=bodies.get(artifact.name);return new Response(body,{status:200,headers:{"content-type":"application/zip","content-disposition":`attachment; filename=${artifact.name}`,"content-length":String(body.length)}})}return new Response("<!doctype html><title>YNX Wallet</title>",{status:200,headers:{"content-type":"text/html; charset=utf-8"}})};
  const result=await run(fakeFetch),retryProved=result.artifacts.find(item=>item.url===retryTarget)?.attempts===2;console.log(JSON.stringify({mode:"self-test",retryProved,...result},null,2));process.exit(result.passed&&retryProved?0:1);
}

if(process.argv.includes("--self-test"))await selfTest();
const expectUnpublished=process.argv.includes("--expect-unpublished"),checks=await run();
const result={schemaVersion:1,sourceCommit:acquisition.sourceCommit,artifactCarrierCommit:acquisition.artifactCarrierCommit,observedAt:new Date().toISOString(),mode:expectUnpublished?"truthful-unpublished-monitor":"production-release-gate",...checks,browserVisibleAcceptance:false,deployedPublic:checks.passed,downloadHosted:checks.passed,productionSigned:false,storeReleased:false};
result.gatePassed=expectUnpublished?!checks.passed:checks.passed;await mkdir(dirname(evidencePath),{recursive:true});await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result,null,2));process.exit(result.gatePassed?0:1);
