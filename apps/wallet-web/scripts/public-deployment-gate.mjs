import {mkdir,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {validateWalletPublicRegistry} from "../src/public-deployment-policy.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const evidencePath=join(root,"evidence","runtime","public-deployment-source-gate-20260814.json");
const expectedCommit=process.env.YNX_WALLET_WEB_EXPECTED_COMMIT;
const registryUrl="https://www.ynxweb4.com/releases/ecosystem-release-registry.json";
const result={schemaVersion:1,expectedCommit:expectedCommit||null,registryUrl,observedAt:new Date().toISOString(),registryStatus:null,publishedCommit:null,publicWeb:null,errorCode:null,errorMessage:null,deployedPublic:false,pwaInstalled:false,providerConnected:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false,productionSigned:false,storeReleased:false,passed:false};

try{
  const response=await fetch(registryUrl,{redirect:"error",signal:AbortSignal.timeout(15000)});
  result.registryStatus=response.status;
  if(!response.ok)throw Object.assign(new Error(`Registry HTTP ${response.status}.`),{code:"PUBLIC_REGISTRY_UNAVAILABLE"});
  const registry=await response.json();
  const wallet=registry?.products?.find(item=>item?.key==="wallet");
  result.publishedCommit=wallet?.commit||null;result.publicWeb=wallet?.publicWeb||null;
  Object.assign(result,validateWalletPublicRegistry(registry,expectedCommit));result.passed=true;
}catch(error){result.errorCode=error?.code||(result.registryStatus===null?"PUBLIC_REGISTRY_UNAVAILABLE":error?.name)||"PUBLIC_REGISTRY_UNAVAILABLE";result.errorMessage=error?.message||String(error);}

await mkdir(dirname(evidencePath),{recursive:true});
await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify(result,null,2));
process.exit(result.passed?0:1);
