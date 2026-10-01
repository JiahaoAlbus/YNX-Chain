import {bytesToHex} from "@noble/hashes/utils.js";
import {parseStoredChatDevice,type StoredChatDevice} from "../src/scopedSessionBridge";

const ORIGIN="https://social.ynxweb4.com";
export type ProtectedChatCarrier={version:1;origin:string;account:string;deviceId:string;iv:ArrayBuffer;ciphertext:ArrayBuffer;key:CryptoKey};
export interface ChatCarrierStorage{
  load(account:string):Promise<ProtectedChatCarrier|null>;
  insert(account:string,carrier:ProtectedChatCarrier):Promise<void>;
  legacy(account:string):Promise<string|null>;
  removeLegacy(account:string,expected:string):Promise<void>;
}
export class ChatStorageError extends Error{constructor(readonly code:string,message:string){super(message)}}
const recovery=()=>new ChatStorageError("CHAT_DEVICE_RECOVERY_REQUIRED","Protected chat device could not be verified. Existing carriers were retained; no replacement keys were created.");
const additionalData=(origin:string,account:string,deviceId:string)=>new TextEncoder().encode(JSON.stringify(["ynx-social-chat-device-at-rest-v1",origin,account,deviceId]));

// Reuses the shared browser adapter's platform guarantees: exact HTTPS origin,
// non-extractable WebCrypto CryptoKey, structured-clone IDB persistence/readback.
// AES wrapping changes only LOCAL storage, never the existing Chat wire protocol.
export async function sealChatDevice(crypto:Crypto,account:string,raw:string):Promise<ProtectedChatCarrier>{
  const device=parseStoredChatDevice(raw);if(device.account!==account)throw recovery();
  const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  const iv=crypto.getRandomValues(new Uint8Array(12)),plaintext=new TextEncoder().encode(raw);
  try{const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv:iv.buffer,additionalData:additionalData(ORIGIN,account,device.deviceId).buffer},key,plaintext.buffer);return {version:1,origin:ORIGIN,account,deviceId:device.deviceId,key,iv:iv.buffer,ciphertext}}finally{plaintext.fill(0)}
}
export async function openChatDevice(crypto:Crypto,account:string,carrier:ProtectedChatCarrier):Promise<string>{
  const algorithm=carrier?.key?.algorithm as AesKeyAlgorithm|undefined;
  if(carrier?.version!==1||carrier.origin!==ORIGIN||carrier.account!==account||!carrier.key||carrier.key.type!=="secret"||carrier.key.extractable!==false||algorithm?.name!=="AES-GCM"||algorithm.length!==256||!carrier.key.usages.includes("decrypt")||carrier.iv?.byteLength!==12||carrier.ciphertext?.byteLength<16||carrier.ciphertext?.byteLength>8192)throw recovery();
  let bytes:Uint8Array|undefined;
  try{bytes=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:carrier.iv,additionalData:additionalData(carrier.origin,account,carrier.deviceId).buffer},carrier.key,carrier.ciphertext));const raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes),device=parseStoredChatDevice(raw);if(device.account!==account||device.deviceId!==carrier.deviceId)throw recovery();return raw}catch{throw recovery()}finally{bytes?.fill(0)}
}
export function protectedChatDevices(storage:ChatCarrierStorage,environment:{crypto:Crypto;isSecureContext:boolean;location:{origin:string}}=globalThis){
  function secure(){if(environment.isSecureContext!==true||environment.location.origin!==ORIGIN||!environment.crypto?.subtle)throw new ChatStorageError("CHAT_SECURE_STORAGE_UNAVAILABLE","Chat requires the registered HTTPS origin and persistent non-extractable WebCrypto storage")}
  async function retained(account:string){const carrier=await storage.load(account);return carrier?await openChatDevice(environment.crypto,account,carrier):null}
  return {
    async get(account:string,create:boolean):Promise<StoredChatDevice>{
      secure();if(!/^ynx1[0-9a-z]{38}$/.test(account))throw recovery();
      if(await storage.legacy(account)!==null)throw new ChatStorageError("CHAT_DEVICE_PROTECTION_REQUIRED","An existing browser chat device needs explicit protection. Its keys were retained and no new device was substituted.");
      let raw=await retained(account);
      if(raw===null){if(!create)throw new ChatStorageError("CHAT_DEVICE_MISSING","No retained browser chat device; explicitly approve before creating one");
        const signing=environment.crypto.getRandomValues(new Uint8Array(32)),encryption=environment.crypto.getRandomValues(new Uint8Array(32));
        try{const device={account,deviceId:`social-${bytesToHex(environment.crypto.getRandomValues(new Uint8Array(12)))}`,signingSeed:bytesToHex(signing),encryptionSeed:bytesToHex(encryption)};await storage.insert(account,await sealChatDevice(environment.crypto,account,JSON.stringify(device)))}finally{signing.fill(0);encryption.fill(0)}
        // Read the committed race winner, never return a candidate before readback.
        raw=await retained(account);if(raw===null)throw recovery();
      }
      return parseStoredChatDevice(raw);
    },
    async protectLegacy(account:string,confirmed:boolean){
      secure();if(!confirmed)throw new ChatStorageError("CHAT_PROTECTION_CONFIRMATION_REQUIRED","Confirm protection of this browser's existing device; no wallet/private key import is required");
      const raw=await storage.legacy(account);if(raw===null)throw recovery();const device=parseStoredChatDevice(raw);if(device.account!==account)throw recovery();
      if(await storage.load(account)===null)await storage.insert(account,await sealChatDevice(environment.crypto,account,raw));
      if(await retained(account)!==raw)throw recovery();
      // Explicit compare-and-delete only AFTER exact encrypted readback. Original
      // secret bytes remain recoverable inside the authenticated protected carrier.
      await storage.removeLegacy(account,raw);if(await storage.legacy(account)!==null)throw recovery();
      return device;
    },
  };
}

export function indexedDBChatCarriers(indexedDB:IDBFactory|undefined):ChatCarrierStorage{
  // Constructing/importing the adapter is harmless on unsupported browsers.
  // Check inside each async operation, before key generation or migration.
  const factory=()=>{if(!indexedDB||typeof indexedDB.open!=="function")throw new ChatStorageError("CHAT_SECURE_STORAGE_UNAVAILABLE","Chat requires persistent IndexedDB storage. Existing device data was retained.");return indexedDB};
  const open=()=>new Promise<IDBDatabase>((resolve,reject)=>{const request=factory().open("ynx-social-chat-secrets-v2",1);request.onupgradeneeded=()=>request.result.createObjectStore("devices");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(recovery())});
  const openLegacy=async()=>{
    const idb=factory();
    if(typeof idb.databases==="function"&&!(await idb.databases()).some(item=>item.name==="ynx-social-chat-devices-v1"))return null;
    return new Promise<IDBDatabase|null>((resolve,reject)=>{const request=idb.open("ynx-social-chat-devices-v1");let missing=false;request.onupgradeneeded=()=>{missing=true;request.transaction?.abort()};request.onsuccess=()=>{if(!request.result.objectStoreNames.contains("devices")){request.result.close();reject(recovery())}else resolve(request.result)};request.onerror=()=>missing?resolve(null):reject(recovery())});
  };
  async function operate<T>(db:IDBDatabase,mode:IDBTransactionMode,action:(store:IDBObjectStore,set:(value:T)=>void,guard:(callback:()=>void)=>void)=>void):Promise<T>{
    try{return await new Promise<T>((resolve,reject)=>{const transaction=db.transaction("devices",mode);let result:T;transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(recovery());transaction.onabort=()=>reject(recovery());const guard=(callback:()=>void)=>{try{callback()}catch{reject(recovery());try{transaction.abort()}catch{/* Already inactive: the typed failure remains authoritative. */}}};guard(()=>action(transaction.objectStore("devices"),value=>{result=value},guard))})}finally{db.close()}
  }
  return {
    async load(account){return operate(await open(),"readonly",(store,set)=>{const request=store.get(account);request.onsuccess=()=>set(request.result??null)})},
    async insert(account,carrier){return operate<void>(await open(),"readwrite",(store,set,guard)=>{const request=store.get(account);request.onsuccess=()=>guard(()=>{if(request.result===undefined)store.add(carrier,account);set(undefined)})})},
    async legacy(account){const db=await openLegacy();if(!db)return null;return operate(db,"readonly",(store,set)=>{const request=store.get(account);request.onsuccess=()=>{if(request.result!==undefined&&typeof request.result!=="string"){request.transaction?.abort();return}set(request.result??null)}})},
    async removeLegacy(account,expected){const db=await openLegacy();if(!db)throw recovery();return operate<void>(db,"readwrite",(store,set)=>{const request=store.get(account);request.onsuccess=()=>{if(request.result!==expected){request.transaction?.abort();return}store.delete(account);set(undefined)}})},
  };
}
