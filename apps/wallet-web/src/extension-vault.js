import {secp256k1} from "@noble/curves/secp256k1.js";
import {keccak_256} from "@noble/hashes/sha3.js";
import {bytesToHex,hexToBytes} from "@noble/hashes/utils.js";

export const EXTENSION_VAULT_KEY="ynx.wallet.provider.vault.v1";
export const EXTENSION_VAULT_SOURCE="ynx-wallet-vault";
export const EXTENSION_VAULT_KDF_ITERATIONS=600000;
const ADDRESS=/^0x[0-9a-f]{40}$/u,HEX_SECRET=/^[0-9a-f]{64}$/u,B64=/^[A-Za-z0-9_-]+$/u;
const encoder=new TextEncoder(),decoder=new TextDecoder();

function fail(code,message){throw Object.assign(new Error(message),{code})}
function plain(value){return typeof value==="object"&&value!==null&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype}
function exact(value,keys,label){if(!plain(value)||Object.keys(value).sort().join(",")!==[...keys].sort().join(","))fail("VAULT_TAMPERED",`${label} is invalid.`);return value}
function bytesToBase64Url(bytes){let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replaceAll("+","-").replaceAll("/","_").replace(/=+$/u,"")}
function base64UrlToBytes(value,label){if(typeof value!=="string"||value.length<16||!B64.test(value))fail("VAULT_TAMPERED",`${label} is invalid.`);try{const padded=value.replaceAll("-","+").replaceAll("_","/")+"=".repeat((4-value.length%4)%4),binary=atob(padded);return Uint8Array.from(binary,character=>character.charCodeAt(0))}catch{fail("VAULT_TAMPERED",`${label} is invalid.`)}}
function passwordBytes(password){if(typeof password!=="string"||password.length<12||password.length>256)fail("VAULT_PASSWORD_INVALID","Vault password must contain 12 to 256 characters.");return encoder.encode(password)}
function validSecret(secretHex){if(typeof secretHex!=="string"||!HEX_SECRET.test(secretHex))fail("VAULT_SECRET_INVALID","Recovery key must be exact lowercase 32-byte hex.");const bytes=hexToBytes(secretHex);if(!secp256k1.utils.isValidSecretKey(bytes))fail("VAULT_SECRET_INVALID","Recovery key is outside the secp256k1 range.");return bytes}
function iso(value){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)||new Date(value).toISOString()!==value)fail("VAULT_TAMPERED","Vault creation time is invalid.");return value}
function header(record){return encoder.encode(JSON.stringify({version:record.version,source:record.source,account:record.account,publicKey:record.publicKey,kdf:record.kdf,createdAt:record.createdAt}))}
async function keyFor(password,salt,iterations,cryptoProvider){const base=await cryptoProvider.subtle.importKey("raw",passwordBytes(password),"PBKDF2",false,["deriveKey"]);return cryptoProvider.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}

export function extensionIdentity(secretHex){
  const secret=validSecret(secretHex),publicKey=secp256k1.getPublicKey(secret,true),uncompressed=secp256k1.getPublicKey(secret,false),digest=keccak_256(uncompressed.slice(1));
  return Object.freeze({account:`0x${bytesToHex(digest.slice(-20))}`,publicKey:bytesToHex(publicKey)});
}

export function generateExtensionSecret(cryptoProvider=globalThis.crypto){
  if(typeof cryptoProvider?.getRandomValues!=="function")fail("VAULT_CRYPTO_UNAVAILABLE","Web Crypto is unavailable.");
  let secret;do{secret=cryptoProvider.getRandomValues(new Uint8Array(32))}while(!secp256k1.utils.isValidSecretKey(secret));const secretHex=bytesToHex(secret);secret.fill(0);return secretHex;
}

export function parseEncryptedVault(value){
  const record=exact(value,["version","source","account","publicKey","kdf","cipher","createdAt"],"Encrypted Wallet vault");
  if(record.version!==1||record.source!==EXTENSION_VAULT_SOURCE||!ADDRESS.test(record.account||"")||!/^(02|03)[0-9a-f]{64}$/u.test(record.publicKey||""))fail("VAULT_TAMPERED","Encrypted Wallet vault identity is invalid.");
  const kdf=exact(record.kdf,["name","hash","iterations","salt"],"Vault KDF"),cipher=exact(record.cipher,["name","iv","ciphertext"],"Vault cipher");
  if(kdf.name!=="PBKDF2"||kdf.hash!=="SHA-256"||kdf.iterations!==EXTENSION_VAULT_KDF_ITERATIONS||base64UrlToBytes(kdf.salt,"Vault salt").length!==16)fail("VAULT_TAMPERED","Vault KDF is invalid.");
  if(cipher.name!=="AES-GCM"||base64UrlToBytes(cipher.iv,"Vault IV").length!==12||base64UrlToBytes(cipher.ciphertext,"Vault ciphertext").length<32)fail("VAULT_TAMPERED","Vault cipher is invalid.");
  iso(record.createdAt);return Object.freeze({...record,kdf:Object.freeze({...kdf}),cipher:Object.freeze({...cipher})});
}

export async function createEncryptedVault({password,secretHex,createdAt=new Date().toISOString()},cryptoProvider=globalThis.crypto){
  if(!cryptoProvider?.subtle||typeof cryptoProvider.getRandomValues!=="function")fail("VAULT_CRYPTO_UNAVAILABLE","Web Crypto is unavailable.");
  let secret;if(secretHex===undefined){secretHex=generateExtensionSecret(cryptoProvider);secret=validSecret(secretHex)}else secret=validSecret(secretHex);
  const identity=extensionIdentity(secretHex),salt=cryptoProvider.getRandomValues(new Uint8Array(16)),iv=cryptoProvider.getRandomValues(new Uint8Array(12));
  const record={version:1,source:EXTENSION_VAULT_SOURCE,account:identity.account,publicKey:identity.publicKey,kdf:{name:"PBKDF2",hash:"SHA-256",iterations:EXTENSION_VAULT_KDF_ITERATIONS,salt:bytesToBase64Url(salt)},cipher:{name:"AES-GCM",iv:bytesToBase64Url(iv),ciphertext:"pending"},createdAt:iso(createdAt)};
  const key=await keyFor(password,salt,record.kdf.iterations,cryptoProvider),plaintext=encoder.encode(JSON.stringify({version:1,secretHex}));
  const ciphertext=new Uint8Array(await cryptoProvider.subtle.encrypt({name:"AES-GCM",iv,additionalData:header(record),tagLength:128},key,plaintext));secret.fill(0);record.cipher.ciphertext=bytesToBase64Url(ciphertext);return parseEncryptedVault(record);
}

export async function unlockEncryptedVault(value,password,cryptoProvider=globalThis.crypto){
  const record=parseEncryptedVault(value),salt=base64UrlToBytes(record.kdf.salt,"Vault salt"),iv=base64UrlToBytes(record.cipher.iv,"Vault IV"),ciphertext=base64UrlToBytes(record.cipher.ciphertext,"Vault ciphertext"),key=await keyFor(password,salt,record.kdf.iterations,cryptoProvider);
  let decrypted;try{decrypted=await cryptoProvider.subtle.decrypt({name:"AES-GCM",iv,additionalData:header({...record,cipher:{...record.cipher,ciphertext:"pending"}}),tagLength:128},key,ciphertext)}catch{fail("VAULT_UNLOCK_FAILED","Password is incorrect or the Wallet vault was changed.")}
  let payload;try{payload=JSON.parse(decoder.decode(decrypted))}catch{fail("VAULT_TAMPERED","Wallet vault plaintext is invalid.")}
  exact(payload,["version","secretHex"],"Wallet vault plaintext");if(payload.version!==1)fail("VAULT_TAMPERED","Wallet vault plaintext version is invalid.");
  const identity=extensionIdentity(payload.secretHex);if(identity.account!==record.account||identity.publicKey!==record.publicKey)fail("VAULT_TAMPERED","Wallet vault identity binding failed.");return Object.freeze({secretHex:payload.secretHex,account:identity.account,publicKey:identity.publicKey});
}

export function providerAccountFromVault(value){const record=parseEncryptedVault(value);return Object.freeze({version:1,source:EXTENSION_VAULT_SOURCE,account:record.account})}
