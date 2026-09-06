import {LOCALES} from "./i18n.js";

export const PREFERENCES_KEY="ynx.wallet.web.preferences.v1";
export const LEGACY_LOCALE_KEY="ynx.wallet.web.locale";
export const LEGACY_THEME_KEY="ynx.wallet.web.theme";
export const PREFERENCES_TTL_MS=180*24*60*60*1000;
const LOCALE_SET=new Set(LOCALES.map(([locale])=>locale)),THEME_SET=new Set(["system","light","dark"]),FIELDS=["schemaVersion","revision","locale","theme","updatedAt","expiresAt"];
const defaults=()=>Object.freeze({schemaVersion:1,revision:0,locale:"en",theme:"system",updatedAt:null,expiresAt:null});
function failure(code,message){throw Object.assign(new Error(message),{code})}
function canonicalTime(value){return typeof value==="string"&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value}

export function parsePreferencesRecord(input,now=Date.now()){
  let raw;try{raw=typeof input==="string"?JSON.parse(input):input}catch{failure("PREFERENCES_INVALID_JSON","Wallet preferences JSON is invalid.")}
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).sort().join("\n")!==[...FIELDS].sort().join("\n"))failure("PREFERENCES_INVALID_SHAPE","Wallet preferences fields are invalid.");
  if(raw.schemaVersion!==1||!Number.isSafeInteger(raw.revision)||raw.revision<1||!LOCALE_SET.has(raw.locale)||!THEME_SET.has(raw.theme)||!canonicalTime(raw.updatedAt)||!canonicalTime(raw.expiresAt))failure("PREFERENCES_INVALID_VALUE","Wallet preferences values are invalid.");
  const updated=Date.parse(raw.updatedAt),expires=Date.parse(raw.expiresAt);
  if(updated>now+30000||expires<=now||expires<=updated||expires-updated!==PREFERENCES_TTL_MS)failure(expires<=now?"PREFERENCES_EXPIRED":"PREFERENCES_INVALID_TIME","Wallet preferences timing is invalid.");
  return Object.freeze({...raw});
}

export function loadPreferences(storage,now=Date.now()){
  if(!storage?.getItem)return Object.freeze({record:defaults(),status:"default",errorCode:"PREFERENCES_STORAGE_UNAVAILABLE"});
  const encoded=storage.getItem(PREFERENCES_KEY);
  if(encoded!==null){try{return Object.freeze({record:parsePreferencesRecord(encoded,now),status:"restored",errorCode:null})}catch(error){storage.removeItem?.(PREFERENCES_KEY);return Object.freeze({record:defaults(),status:"rejected",errorCode:error.code||"PREFERENCES_REJECTED"})}}
  const locale=storage.getItem(LEGACY_LOCALE_KEY),theme=storage.getItem(LEGACY_THEME_KEY);
  if(LOCALE_SET.has(locale)||THEME_SET.has(theme)){
    const record=savePreferences(storage,defaults(),{locale:LOCALE_SET.has(locale)?locale:"en",theme:THEME_SET.has(theme)?theme:"system"},now);
    return Object.freeze({record,status:"migrated",errorCode:null});
  }
  if(locale!==null||theme!==null){storage.removeItem?.(LEGACY_LOCALE_KEY);storage.removeItem?.(LEGACY_THEME_KEY);return Object.freeze({record:defaults(),status:"rejected",errorCode:"PREFERENCES_LEGACY_INVALID"})}
  return Object.freeze({record:defaults(),status:"default",errorCode:null});
}

export function savePreferences(storage,current,patch,now=Date.now()){
  if(!storage?.setItem)failure("PREFERENCES_STORAGE_UNAVAILABLE","Wallet preferences storage is unavailable.");
  if(!patch||typeof patch!=="object"||Array.isArray(patch)||!Object.keys(patch).every((key)=>key==="locale"||key==="theme"))failure("PREFERENCES_INVALID_PATCH","Wallet preferences update is invalid.");
  const locale=patch.locale??current?.locale,theme=patch.theme??current?.theme;
  if(!LOCALE_SET.has(locale)||!THEME_SET.has(theme))failure("PREFERENCES_INVALID_VALUE","Wallet preferences values are invalid.");
  const updatedAt=new Date(now).toISOString(),record=Object.freeze({schemaVersion:1,revision:(Number.isSafeInteger(current?.revision)?current.revision:0)+1,locale,theme,updatedAt,expiresAt:new Date(now+PREFERENCES_TTL_MS).toISOString()});
  storage.setItem(PREFERENCES_KEY,JSON.stringify(record));storage.removeItem?.(LEGACY_LOCALE_KEY);storage.removeItem?.(LEGACY_THEME_KEY);return record;
}

export function acceptPreferenceUpdate(current,encoded,now=Date.now()){
  const next=parsePreferencesRecord(encoded,now);
  if(!current||next.revision<=current.revision||Date.parse(next.updatedAt)<=Date.parse(current.updatedAt||0))failure("PREFERENCES_REPLAYED","Stale Wallet preferences update was rejected.");
  return next;
}
