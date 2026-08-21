import * as SecureStore from "expo-secure-store";
import {Platform} from "react-native";
import type {CardSession, PendingAuthorizationRequest} from "./wallet";
import type {SimulationAuditRecord} from "./simulation";
import type {CardRegistration} from "./registration";

const PREFIX="ynx-card.secure.v1.";
const WEB_LOCAL_KEYS=new Set(["locale","simulationAudit","authorization","registration"]);

export async function loadSession():Promise<CardSession|null>{return load<CardSession>("session",value=>value.productClientId==="ynx-card-v1"&&value.bundleId==="com.ynxweb4.card"&&Date.parse(value.expiresAt)>Date.now())}
export async function saveSession(value:CardSession|null){return save("session",value)}
export async function loadPendingAuthorization():Promise<PendingAuthorizationRequest|null>{return load<PendingAuthorizationRequest>("authorization",value=>value.request?.productClientId==="ynx-card-v1"&&Date.parse(value.request.expiresAt)>Date.now())}
export async function savePendingAuthorization(value:PendingAuthorizationRequest|null){return save("authorization",value===null?null:{request:value.request})}

export async function loadLocale():Promise<string|null>{return read("locale")}
export async function saveLocale(value:string){return write("locale",value)}

export async function loadSimulationAudit():Promise<readonly SimulationAuditRecord[]> {
  const raw=await read("simulationAudit");
  if(!raw)return [];
  try{
    const value=JSON.parse(raw) as unknown;
    if(Array.isArray(value)&&value.every(isSimulationAuditRecord))return Object.freeze(value);
  }catch{}
  await write("simulationAudit",null);
  return [];
}

export async function saveSimulationAudit(value:readonly SimulationAuditRecord[]|null){
  return save("simulationAudit",value);
}
export async function loadCardRegistration():Promise<CardRegistration|null>{return load<CardRegistration>("registration",value=>typeof value.id==="string"&&typeof value.owner==="string"&&typeof value.status==="string"&&Array.isArray(value.audit))}
export async function saveCardRegistration(value:CardRegistration|null){return save("registration",value)}

async function save(key:string,value:unknown|null){return write(key,value===null?null:JSON.stringify(value))}
async function load<T extends Record<string,unknown>>(key:string,valid:(value:T)=>boolean):Promise<T|null>{const raw=await read(key);if(!raw)return null;try{const value=JSON.parse(raw) as T;if(valid(value))return value}catch{}await write(key,null);return null}

async function read(key:string):Promise<string|null>{
  if(Platform.OS!=="web")return SecureStore.getItemAsync(PREFIX+key);
  if(!WEB_LOCAL_KEYS.has(key))return null;
  try{return typeof window==="undefined"?null:window.localStorage.getItem(PREFIX+key)}catch{return null}
}

async function write(key:string,value:string|null):Promise<void>{
  if(Platform.OS!=="web"){
    if(value===null){await SecureStore.deleteItemAsync(PREFIX+key);return}
    await SecureStore.setItemAsync(PREFIX+key,value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
    return;
  }
  if(!WEB_LOCAL_KEYS.has(key))return;
  try{
    if(typeof window==="undefined")return;
    if(value===null)window.localStorage.removeItem(PREFIX+key);else window.localStorage.setItem(PREFIX+key,value);
  }catch{}
}

function isSimulationAuditRecord(value:unknown):value is SimulationAuditRecord{
  return object(value)&&typeof value.id==="string"&&typeof value.kind==="string"&&typeof value.cardId==="string"&&typeof value.merchant==="string"&&Number.isInteger(value.amountMinor)&&typeof value.currency==="string"&&typeof value.idempotencyKey==="string"&&typeof value.status==="string"&&typeof value.reason==="string"&&typeof value.createdAt==="string"&&typeof value.updatedAt==="string";
}

function object(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
