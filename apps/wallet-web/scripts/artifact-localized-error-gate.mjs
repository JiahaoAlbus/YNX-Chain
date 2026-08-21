import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const evidencePath=join(root,"evidence","runtime","built-localized-error-gate-20260814.json");
const variants=["ynx-wallet-web-pwa-0.1.0.zip","ynx-wallet-chrome-edge-0.1.0.zip","ynx-wallet-firefox-0.1.0.zip"];
const result={schemaVersion:1,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",generatedAt:new Date().toISOString(),gateClass:"exact built ZIP locale module and UI-source inspection; not visible browser runtime",artifacts:[],browserVisibleRecheck:false,installedLocal:false,providerConnected:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false,deployedPublic:false,productionSigned:false,storeReleased:false,passed:false};

for(const name of variants){
  const archive=join(root,"artifacts",name),temp=await mkdtemp(join(tmpdir(),"ynx-localized-errors-"));
  try{
    execFileSync("unzip",["-q",archive,"-d",temp]);
    const i18n=await import(`${pathToFileURL(join(temp,"i18n.js")).href}?variant=${encodeURIComponent(name)}-${Date.now()}`);
    const app=await readFile(join(temp,"app.js"),"utf8"),bytes=await readFile(archive),info=await stat(archive);
    const runtimeKeys=["requestFailed","noProvider","extensionLocked","siteAccessDenied","ambiguousProvider","wrongChain","rpcUnavailable","invalidRpcResponse"];
    const localeChecks=i18n.LOCALES.map(([locale])=>({locale,untranslated:i18n.untranslatedKeys(locale),messages:Object.fromEntries(runtimeKeys.map((key)=>[key,i18n.catalog(locale)[key]]))}));
    const checks={allLocalesDirect:localeChecks.every(item=>item.untranslated.length===0),allErrorsLocalized:localeChecks.every(item=>runtimeKeys.every((key)=>typeof item.messages[key]==="string"&&item.messages[key].length>10)),arabicExact:i18n.catalog("ar").requestFailed==="فشل الطلب بشكل آمن ولم تتغير حالة المحفظة.",stableCodePreserved:/status\.key\s*\|\|\s*"requestFailed"/u.test(app)&&/function errorStatusKey\(code\)/u.test(app),rawProviderMessageNotRendered:!/error\?\.message \|\|/u.test(app)};
    result.artifacts.push({name,bytes:info.size,sha256:createHash("sha256").update(bytes).digest("hex"),localeChecks,checks,passed:Object.values(checks).every(Boolean)});
  }finally{await rm(temp,{recursive:true,force:true});}
}
result.passed=result.artifacts.every(item=>item.passed);
await mkdir(dirname(evidencePath),{recursive:true});await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);
