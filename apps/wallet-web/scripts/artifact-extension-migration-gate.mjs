import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const evidencePath=join(root,"evidence","runtime","extension-upgrade-migration-20260814.json");
const variants=[{name:"ynx-wallet-chrome-edge-0.1.0.zip",platform:"chromium",alarmsApi:true},{name:"ynx-wallet-firefox-0.1.0.zip",platform:"firefox",alarmsApi:false}];
const temp=await mkdtemp(join(tmpdir(),"ynx-extension-migration-"));
const result={schemaVersion:1,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",generatedAt:new Date().toISOString(),gateClass:"executable migration policy imported from exact built ZIPs; not a browser installation",passed:false,artifacts:[],providerConnected:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false,installedLocal:false,deployedPublic:false,downloadHosted:false,productionSigned:false,storeReleased:false};
let diagnostic={stage:"startup",state:null};

function fake(module,{alarmsApi,removeWorks=true,rpc=true}={}){
  const state={origins:[...(rpc?[module.REQUIRED_PROVIDER_ORIGIN]:[]),...module.LEGACY_ORIGIN_GRANTS],scripts:[{id:"legacy-static-shadow"}],alarms:alarmsApi?[{name:"legacy-refresh"}]:null,local:{},account:{sentinel:"untouched"},calls:[]};
  const api={
    permissions:{async getAll(){return{origins:[...state.origins]}},async remove({origins}){state.calls.push(["removeOrigins",origins]);if(removeWorks)state.origins=state.origins.filter(item=>!origins.includes(item));return removeWorks}},
    scripting:{async getRegisteredContentScripts(){return state.scripts.map(item=>({...item}))},async unregisterContentScripts({ids}){state.calls.push(["unregister",ids]);state.scripts=state.scripts.filter(item=>!ids.includes(item.id))}},
    storage:{local:{async set(value){Object.assign(state.local,value)}},session:{account:state.account}},
  };
  if(alarmsApi)api.alarms={async getAll(){return state.alarms.map(item=>({...item}))},async clear(name){state.calls.push(["alarm",name]);state.alarms=state.alarms.filter(item=>item.name!==name);return true}};
  return{state,api};
}
async function send(listener,message,sender={}){return await new Promise((resolveSend,reject)=>{const timer=setTimeout(()=>reject(new Error("Service worker migration response timed out.")),1000),respond=value=>{clearTimeout(timer);resolveSend(value)};try{if(listener(message,sender,respond)!==true){clearTimeout(timer);resolveSend(undefined)}}catch(error){clearTimeout(timer);reject(error)}})}
async function serviceWorkerFailureGate(target,module,platform){
  const state={listener:null,origins:[module.REQUIRED_PROVIDER_ORIGIN,module.LEGACY_ORIGIN_GRANTS[0]],scriptingCalls:0,local:{},session:{}};
  globalThis.chrome={runtime:{onMessage:{addListener(listener){state.listener=listener}}},permissions:{async getAll(){return{origins:[...state.origins]}},async remove(){return false}},scripting:{async getRegisteredContentScripts(){return[]},async unregisterContentScripts(){},async executeScript(){state.scriptingCalls+=1;return[]}},storage:{local:{async set(value){Object.assign(state.local,value)}},session:{async get(key){return{[key]:state.session[key]}},async set(value){Object.assign(state.session,value)}}},tabs:{async query(){return[{id:7,url:"http://127.0.0.1:4173/"}]},async get(){return{id:7,url:"http://127.0.0.1:4173/"}},async sendMessage(){}}};
  await import(`${pathToFileURL(join(target,"service-worker.js")).href}?migration-failure=${platform}-${Date.now()}`);
  const discovery=await send(state.listener,{type:"YNX_WALLET_DISCOVER"}),sensitive=await send(state.listener,{type:"YNX_DAPP_REQUEST_V1",version:1,requestId:"ynx-11111111-1111-4111-8111-111111111111",origin:"http://127.0.0.1:4173",method:"eth_requestAccounts",params:[],deadlineAt:Date.now()+18000},{tab:{id:7,url:"http://127.0.0.1:4173/"},url:"http://127.0.0.1:4173/",frameId:0});
  return{discovery,sensitive,scriptingCalls:state.scriptingCalls,passed:discovery?.error?.code==="MIGRATION_INCOMPLETE"&&sensitive?.ok===false&&sensitive.error?.code==="MIGRATION_INCOMPLETE"&&state.scriptingCalls===0};
}

try{
  for(const variant of variants){
    const archive=join(root,"artifacts",variant.name),target=join(temp,variant.platform);await mkdir(target,{recursive:true});execFileSync("unzip",["-q",archive,"-d",target]);
    const module=await import(`${pathToFileURL(join(target,"extension-migration.js")).href}?platform=${variant.platform}`),manifest=JSON.parse(await readFile(join(target,"manifest.json"),"utf8")),upgrade=fake(module,{alarmsApi:variant.alarmsApi});
    diagnostic={stage:`${variant.platform}:upgrade`,state:upgrade.state};const first=await module.runExtensionMigration(upgrade.api,{alarmsDeclared:manifest.permissions.includes("alarms"),now:0});
    diagnostic.stage=`${variant.platform}:second`;const second=await module.runExtensionMigration(upgrade.api,{alarmsDeclared:manifest.permissions.includes("alarms"),now:1000});
    let cleanupFailure,providerPermissionFailure;
    try{const broken=fake(module,{alarmsApi:variant.alarmsApi,removeWorks:false});diagnostic={stage:`${variant.platform}:cleanup-failure`,state:broken.state};await module.runExtensionMigration(broken.api);cleanupFailure={failedClosed:false}}catch(error){cleanupFailure={failedClosed:true,code:error?.code||null}}
    try{const missing=fake(module,{alarmsApi:variant.alarmsApi,rpc:false});diagnostic={stage:`${variant.platform}:provider-permission-failure`,state:missing.state};await module.runExtensionMigration(missing.api);providerPermissionFailure={failedClosed:false}}catch(error){providerPermissionFailure={failedClosed:true,code:error?.code||null}}
    const messageFailure=await serviceWorkerFailureGate(target,module,variant.platform),bytes=await readFile(archive),info=await stat(archive),passed=upgrade.state.origins.length===1&&upgrade.state.origins[0]===module.REQUIRED_PROVIDER_ORIGIN&&upgrade.state.scripts.length===0&&(!variant.alarmsApi||upgrade.state.alarms.length===0)&&upgrade.state.account.sentinel==="untouched"&&first.accountStateTouched===false&&second.legacyOriginsRemoved.length===0&&second.dynamicScriptIdsRemoved.length===0&&cleanupFailure.code==="MIGRATION_ORIGIN_REMAINS"&&providerPermissionFailure.code==="REQUIRED_PROVIDER_PERMISSION_MISSING"&&messageFailure.passed&&!manifest.permissions.includes("alarms");
    result.artifacts.push({name:variant.name,platform:variant.platform,bytes:info.size,sha256:createHash("sha256").update(bytes).digest("hex"),firstInstallOrUpgrade:first,secondStartup:second,finalOrigins:upgrade.state.origins,dynamicScriptsRemaining:upgrade.state.scripts.length,alarmsRemaining:variant.alarmsApi?upgrade.state.alarms.length:"API unavailable and permission never declared",accountStateTouched:false,cleanupFailure,providerPermissionFailure,messageFailure,passed});
  }
  result.passed=result.artifacts.every(item=>item.passed);
}catch(error){result.error={name:error?.name||"Error",code:error?.code||null,message:error?.message||String(error),stage:diagnostic.stage,state:diagnostic.state};}
finally{await rm(temp,{recursive:true,force:true}).catch(()=>{})}
await mkdir(dirname(evidencePath),{recursive:true});await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);
