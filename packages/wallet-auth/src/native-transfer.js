import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { exactFields, WalletAuthError } from "./canonical.js";
import { evmAddressFromYNX, walletIdentity, walletIdentityFromPublicKey } from "./crypto.js";

const TRANSACTION_FIELDS=["version","chainId","type","from","to","amount","fee","nonce","publicKey","signature"];
const CREATE_FIELDS=["accountSecret","to","amount","nonce"];
export const NATIVE_TRANSACTION_DOMAIN="YNX_NATIVE_TX_V1";
export const NATIVE_TRANSACTION_CHAIN_ID=6423;
export const NATIVE_TRANSACTION_FEE_YNXT=1;

export function createSignedNativeTransfer(input){
  exactFields(input,CREATE_FIELDS,"Native transfer input");
  const secret=secretBytes(input.accountSecret);
  const identity=walletIdentity(input.accountSecret);
  const unsigned={version:1,chainId:NATIVE_TRANSACTION_CHAIN_ID,type:"transfer",from:evmAddressFromYNX(identity.account),to:evmAddressFromYNX(input.to),amount:positiveSafeInteger(input.amount,"amount"),fee:NATIVE_TRANSACTION_FEE_YNXT,nonce:positiveSafeInteger(input.nonce,"nonce"),publicKey:identity.accountPublicKey};
  if(unsigned.from===unsigned.to)throw new WalletAuthError("INVALID_TRANSFER","Native transfer sender and recipient must differ");
  const digest=sha256(utf8ToBytes(nativeTransferSignJSON(unsigned)));
  const signature=bytesToHex(secp256k1.sign(digest,secret,{prehash:false,format:"der",lowS:true}));
  const transaction=parseSignedNativeTransfer({...unsigned,signature});
  const payload=JSON.stringify(transaction);
  return Object.freeze({transaction,payload,hash:nativeTransferHash(payload)});
}

export function parseSignedNativeTransfer(input){
  let raw=null,value=input;
  if(typeof input==="string"){
    raw=input;
    try{value=JSON.parse(input)}catch{throw new WalletAuthError("INVALID_TRANSFER","Native transfer JSON is invalid")}
  }
  exactFields(value,TRANSACTION_FIELDS,"Signed native transfer");
  const transaction={version:exactInteger(value.version,"version",1),chainId:exactInteger(value.chainId,"chainId",NATIVE_TRANSACTION_CHAIN_ID),type:exactString(value.type,"type",/^transfer$/),from:exactString(value.from,"from",/^0x[0-9a-f]{40}$/),to:exactString(value.to,"to",/^0x[0-9a-f]{40}$/),amount:positiveSafeInteger(value.amount,"amount"),fee:exactInteger(value.fee,"fee",NATIVE_TRANSACTION_FEE_YNXT),nonce:positiveSafeInteger(value.nonce,"nonce"),publicKey:exactString(value.publicKey,"publicKey",/^(02|03)[0-9a-f]{64}$/),signature:exactString(value.signature,"signature",/^30[0-9a-f]{134,142}$/)};
  if(transaction.from===transaction.to)throw new WalletAuthError("INVALID_TRANSFER","Native transfer sender and recipient must differ");
  let valid=false;
  try{
    const derived=evmAddressFromYNX(walletIdentityFromPublicKey(transaction.publicKey));
    valid=derived===transaction.from&&secp256k1.verify(hexToBytes(transaction.signature),sha256(utf8ToBytes(nativeTransferSignJSON(transaction))),hexToBytes(transaction.publicKey),{prehash:false,format:"der",lowS:true});
  }catch{valid=false}
  if(!valid)throw new WalletAuthError("INVALID_TRANSFER_SIGNATURE","Native transfer signature is invalid");
  const frozen=Object.freeze(transaction);
  if(raw!==null&&raw!==JSON.stringify(frozen))throw new WalletAuthError("INVALID_TRANSFER","Native transfer JSON is not canonical");
  return frozen;
}

export function nativeTransferSignJSON(transaction){
  return JSON.stringify({domain:NATIVE_TRANSACTION_DOMAIN,version:transaction.version,chainId:transaction.chainId,type:transaction.type,from:transaction.from,to:transaction.to,amount:transaction.amount,fee:transaction.fee,nonce:transaction.nonce,publicKey:transaction.publicKey});
}

export function nativeTransferHash(payload){
  const parsed=parseSignedNativeTransfer(payload);
  const canonical=JSON.stringify(parsed);
  return `0x${bytesToHex(sha256(utf8ToBytes(canonical)))}`;
}

function secretBytes(value){if(typeof value!=="string"||!/^[0-9a-f]{64}$/.test(value)){throw new WalletAuthError("INVALID_SECRET","Wallet account secret must be 32-byte lowercase hex")}const secret=hexToBytes(value);if(!secp256k1.utils.isValidSecretKey(secret))throw new WalletAuthError("INVALID_SECRET","Wallet account secret is outside the secp256k1 range");return secret}
function positiveSafeInteger(value,label){if(!Number.isSafeInteger(value)||value<=0)throw new WalletAuthError("INVALID_TRANSFER",`${label} must be a positive safe integer`);return value}
function exactInteger(value,label,expected){if(value!==expected)throw new WalletAuthError("INVALID_TRANSFER",`${label} must equal ${expected}`);return value}
function exactString(value,label,pattern){if(typeof value!=="string"||value.trim()!==value||!pattern.test(value))throw new WalletAuthError("INVALID_TRANSFER",`${label} is invalid`);return value}
