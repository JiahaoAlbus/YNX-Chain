export const EXTENSION_MIGRATION_VERSION=3;
export const EXTENSION_MIGRATION_KEY="ynx.extension.migration.v3";
export const REQUIRED_RPC_ORIGIN="https://evm.ynxweb4.com/*";
export const REQUIRED_DAPP_ORIGIN="https://*/*";
export const LEGACY_ORIGIN_GRANTS=Object.freeze(["http://*/*","http://localhost/*","http://127.0.0.1/*"]);

function fail(code,message,cause){throw Object.assign(new Error(message),{code,cause})}
async function requireCall(target,name,...args){if(typeof target?.[name]!=="function")fail("MIGRATION_API_UNAVAILABLE",`Extension migration API ${name} is unavailable.`);try{return await target[name](...args)}catch(error){fail("MIGRATION_CLEANUP_FAILED",`Extension migration ${name} failed.`,error)}}

export async function runExtensionMigration(api,options={}){
  const permissions=api?.permissions,scripting=api?.scripting,local=api?.storage?.local,alarms=api?.alarms,alarmsDeclared=options.alarmsDeclared===true;
  if(!permissions||!scripting||!local||typeof local.set!=="function")fail("MIGRATION_API_UNAVAILABLE","Required extension migration APIs are unavailable.");
  const before=await requireCall(permissions,"getAll"),beforeOrigins=Array.isArray(before?.origins)?before.origins:[];
  const legacyOrigins=LEGACY_ORIGIN_GRANTS.filter(origin=>beforeOrigins.includes(origin));
  if(legacyOrigins.length)await requireCall(permissions,"remove",{origins:legacyOrigins});
  const registered=await requireCall(scripting,"getRegisteredContentScripts"),scriptIds=Array.isArray(registered)?registered.map(item=>item?.id).filter(id=>typeof id==="string"&&id.length>0):[];
  if(scriptIds.length)await requireCall(scripting,"unregisterContentScripts",{ids:scriptIds});
  let alarmNames=[],alarmCleanup="not-declared-api-unavailable";
  if(alarms&&typeof alarms.getAll==="function"&&typeof alarms.clear==="function"){
    const existing=await requireCall(alarms,"getAll");alarmNames=Array.isArray(existing)?existing.map(item=>item?.name).filter(name=>typeof name==="string"&&name.length>0):[];
    for(const name of alarmNames)await requireCall(alarms,"clear",name);
    if((await requireCall(alarms,"getAll")).length)fail("MIGRATION_ALARMS_REMAIN","Extension alarms remained after cleanup.");
    alarmCleanup="verified-empty";
  }else if(alarmsDeclared)fail("MIGRATION_API_UNAVAILABLE","Declared alarms permission cannot be cleaned up.");
  const after=await requireCall(permissions,"getAll"),afterOrigins=Array.isArray(after?.origins)?after.origins:[];
  if(LEGACY_ORIGIN_GRANTS.some(origin=>afterOrigins.includes(origin)))fail("MIGRATION_ORIGIN_REMAINS","Legacy extension origin permission remained after cleanup.");
  if(!afterOrigins.includes(REQUIRED_DAPP_ORIGIN))fail("REQUIRED_DAPP_PERMISSION_MISSING","HTTPS DApp provider permission is missing after migration.");
  if((await requireCall(scripting,"getRegisteredContentScripts")).length)fail("MIGRATION_CONTENT_SCRIPT_REMAINS","Dynamic content scripts remained after cleanup.");
  const report=Object.freeze({schemaVersion:1,migrationVersion:EXTENSION_MIGRATION_VERSION,legacyOriginsRemoved:Object.freeze([...legacyOrigins]),dynamicScriptIdsRemoved:Object.freeze([...scriptIds]),alarmNamesRemoved:Object.freeze([...alarmNames]),alarmCleanup,httpsDappOriginRetained:true,rpcOriginCoveredByHttpsDappPermission:afterOrigins.includes(REQUIRED_DAPP_ORIGIN),accountStateTouched:false,completedAt:new Date(options.now??Date.now()).toISOString()});
  try{await local.set({[EXTENSION_MIGRATION_KEY]:report})}catch(error){fail("MIGRATION_STATE_WRITE_FAILED","Extension migration report could not be saved.",error)}
  return report;
}
