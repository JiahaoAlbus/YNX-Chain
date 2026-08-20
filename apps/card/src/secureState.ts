import * as SecureStore from "expo-secure-store";
import type {CardSession, PendingAuthorization} from "./wallet";
import type {SimulationAuditRecord} from "./simulation";

const PREFIX="ynx-card.secure.v1.";

export async function loadSession():Promise<CardSession|null>{return load<CardSession>("session",value=>value.productClientId==="ynx-card-v1"&&value.bundleId==="com.ynxweb4.card"&&Date.parse(value.expiresAt)>Date.now())}
export async function saveSession(value:CardSession|null){return save("session",value)}
export async function loadPendingAuthorization():Promise<PendingAuthorization|null>{return load<PendingAuthorization>("authorization",value=>value.request?.productClientId==="ynx-card-v1"&&typeof value.deviceSecret==="string"&&Date.parse(value.request.expiresAt)>Date.now())}
export async function savePendingAuthorization(value:PendingAuthorization|null){return save("authorization",value)}

export async function loadLocale():Promise<string|null>{return SecureStore.getItemAsync(PREFIX+"locale")}
export async function saveLocale(value:string){return SecureStore.setItemAsync(PREFIX+"locale",value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY})}

export async function loadSimulationAudit():Promise<readonly SimulationAuditRecord[]> {
  const raw=await SecureStore.getItemAsync(PREFIX+"simulationAudit");
  if(!raw)return [];
  try{
    const value=JSON.parse(raw) as unknown;
    if(Array.isArray(value)&&value.every(isSimulationAuditRecord))return Object.freeze(value);
  }catch{}
  await SecureStore.deleteItemAsync(PREFIX+"simulationAudit");
  return [];
}

export async function saveSimulationAudit(value:readonly SimulationAuditRecord[]|null){
  return save("simulationAudit",value);
}

async function save(key:string,value:unknown|null){if(value===null)return SecureStore.deleteItemAsync(PREFIX+key);return SecureStore.setItemAsync(PREFIX+key,JSON.stringify(value),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY})}
async function load<T extends Record<string,unknown>>(key:string,valid:(value:T)=>boolean):Promise<T|null>{const raw=await SecureStore.getItemAsync(PREFIX+key);if(!raw)return null;try{const value=JSON.parse(raw) as T;if(valid(value))return value}catch{}await SecureStore.deleteItemAsync(PREFIX+key);return null}

function isSimulationAuditRecord(value:unknown):value is SimulationAuditRecord{
  return object(value)&&typeof value.id==="string"&&typeof value.kind==="string"&&typeof value.cardId==="string"&&typeof value.merchant==="string"&&Number.isInteger(value.amountMinor)&&typeof value.currency==="string"&&typeof value.idempotencyKey==="string"&&typeof value.status==="string"&&typeof value.reason==="string"&&typeof value.createdAt==="string"&&typeof value.updatedAt==="string";
}

function object(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
