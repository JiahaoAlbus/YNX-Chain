const encoder=new TextEncoder();
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
async function deviceKey(client){
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("ynx-product-device-v1",1);request.onupgradeneeded=()=>request.result.createObjectStore("keys");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
  const existing=await new Promise((resolve,reject)=>{const request=db.transaction("keys").objectStore("keys").get(client);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
  const pair=existing||await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  if(!existing)await new Promise((resolve,reject)=>{const request=db.transaction("keys","readwrite").objectStore("keys").put(pair,client);request.onsuccess=resolve;request.onerror=()=>reject(request.error)});
  const raw=new Uint8Array(await crypto.subtle.exportKey("raw",pair.publicKey));if(raw.length!==65||raw[0]!==4)throw new Error("P-256 public key encoding failed");
  const compressed=new Uint8Array(33);compressed[0]=(raw[64]&1)?3:2;compressed.set(raw.slice(1,33),1);return b64url(compressed);
}
export async function walletAuthorizationURL({requestingProduct,productClientId,bundleId,callback,scopes,purpose}){
  const issued=new Date(),expires=new Date(issued.getTime()+300_000),nonce=new Uint8Array(24);crypto.getRandomValues(nonce);
  const request=canonical({version:"1",nonce:b64url(nonce),chainId:"ynx_6423-1",requestingProduct,productClientId,bundleId,productDeviceAlgorithm:"p256-sha256",productDeviceKey:await deviceKey(productClientId),callback,scopes:[...scopes].sort(),purpose,issuedAt:issued.toISOString(),expiresAt:expires.toISOString()});
  return `ynxwallet://authorize?request=${encodeURIComponent(b64url(encoder.encode(JSON.stringify(request))))}`;
}
