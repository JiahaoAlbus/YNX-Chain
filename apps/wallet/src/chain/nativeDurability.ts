import type { SignedNativeTransfer } from "@ynx-chain/wallet-auth";

export const NATIVE_DURABILITY_MODEL=Object.freeze({version:"ynx-local-durability-v1",scope:"local-snapshot",receiptField:"ynxDurability",transactionStatusMethod:"ynx_getTransactionDurability",nativeTransactionField:"ynxNativeTransaction",minedStatus:"durable",pendingStatus:"pending_durable",consensusFinality:false});
export type NativeDurabilityStatus="durable"|"pending_durable"|"uncertain"|"memory_only"|"not_found";
export type NativeDurabilityCheck=Readonly<{status:NativeDurabilityStatus|"unsupported";evidence:Readonly<Record<string,unknown>>|null}>;
export class NativeDurabilityInvalid extends Error {readonly code="NATIVE_DURABILITY_INVALID";constructor(){super("The node's local durability proof could not be verified. The original transfer remains stored.")}}
const invalid=():never=>{throw new NativeDurabilityInvalid()};
const hash=(value:unknown):string=>typeof value==="string"&&/^0x[0-9a-f]{64}$/.test(value)?value:invalid();
function exact(value:unknown,fields:readonly string[]):Record<string,any>{if(!value||typeof value!=="object"||Array.isArray(value)||Reflect.ownKeys(value).length!==fields.length)invalid();const record=value as Record<string,any>;for(const field of fields){const descriptor=Object.getOwnPropertyDescriptor(record,field);if(!descriptor||!Object.hasOwn(descriptor,"value"))invalid()}return record}
function record(value:unknown):Record<string,any>{if(!value||typeof value!=="object"||Array.isArray(value))invalid();return value as Record<string,any>}
export function nativeQuantity(value:unknown,positive=false):bigint{if(typeof value!=="string"||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)||value.length>18)invalid();const parsed=BigInt(value as string);if(parsed>0xffffffffffffffffn||positive&&parsed===0n)invalid();return parsed}
function decimal(value:unknown):bigint{if(typeof value!=="string"||! /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(value)||value.length>20)invalid();const parsed=BigInt(value as string);if(parsed<-(1n<<63n)||parsed>=(1n<<63n))invalid();return parsed}
function nativeTransferFields(value:unknown,expected:SignedNativeTransfer):Record<string,any>{
  const fields=["type","amountYNXT","feeYNXT","nonce"], candidate=record(value);
  const extended=["from","to","identityProjection"].some(key=>Object.hasOwn(candidate,key));
  exact(candidate,extended?[...fields,"from","to","identityProjection"]:fields);
  if(extended){
    const identity={version:"ynx-native-identity-projection-v1",fromSystemIdentity:false,toSystemIdentity:false,systemAddressDomain:"YNX_NATIVE_IDENTITY_PROJECTION_V1",systemAddressScheme:"last-20-bytes-sha256-nul-domain-exact-native-identity",systemAddressesAreDisplayOnly:true};
    const projection=exact(candidate.identityProjection,Object.keys(identity));
    if(candidate.from!==expected.from||candidate.to!==expected.to||Object.entries(identity).some(([key,value])=>projection[key]!==value))invalid();
  }
  // Save the stable ledger contract after validating optional identity metadata.
  // System display identities must never stand in for a signed transfer address.
  return Object.fromEntries(fields.map(key=>[key,candidate[key]]));
}
export function parseNativeDurabilityModel(value:unknown):typeof NATIVE_DURABILITY_MODEL{const parsed=exact(value,Object.keys(NATIVE_DURABILITY_MODEL));for(const [key,expected] of Object.entries(NATIVE_DURABILITY_MODEL))if(parsed[key]!==expected)invalid();return NATIVE_DURABILITY_MODEL}
export function parseNativeDurabilityState(value:unknown,expectedHash:string):Readonly<Record<string,any>>{
  hash(expectedHash);const parsed=record(value),status=parsed.status as NativeDurabilityStatus;
  const fields=["version","scope","status","transactionHash"];
  if(status==="durable")fields.push("blockNumber","blockHash","checkpointBlockNumber","checkpointBlockHash","snapshotIntegrity");
  else if(status==="pending_durable")fields.push("checkpointBlockNumber","checkpointBlockHash","snapshotIntegrity");
  else if(status==="uncertain"||status==="memory_only"){if(Object.hasOwn(parsed,"blockNumber")||Object.hasOwn(parsed,"blockHash"))fields.push("blockNumber","blockHash")}
  else if(status!=="not_found")invalid();
  exact(parsed,fields);
  if(parsed.version!==NATIVE_DURABILITY_MODEL.version||parsed.scope!==NATIVE_DURABILITY_MODEL.scope||hash(parsed.transactionHash)!==expectedHash)invalid();
  if(Object.hasOwn(parsed,"blockNumber")){nativeQuantity(parsed.blockNumber,true);hash(parsed.blockHash)}
  if(status==="durable"||status==="pending_durable"){
    const checkpoint=nativeQuantity(parsed.checkpointBlockNumber);hash(parsed.checkpointBlockHash);hash(parsed.snapshotIntegrity);
    if(status==="durable"){
      const height=nativeQuantity(parsed.blockNumber,true);if(checkpoint<height||(checkpoint===height)!==(parsed.checkpointBlockHash===parsed.blockHash))invalid();
    }
  }
  return Object.freeze({...parsed});
}
export function parseNativeDurableReceipt(value:unknown,expected:SignedNativeTransfer,expectedHash:string):Readonly<Record<string,unknown>>{
  const receipt=record(value),proof=parseNativeDurabilityState(receipt.ynxDurability,expectedHash);
  if(proof.status!=="durable"||receipt.status!=="0x1"||receipt.transactionHash!==expectedHash||receipt.from!==expected.from||receipt.to!==expected.to||receipt.contractAddress!==null||receipt.blockNumber!==proof.blockNumber||receipt.blockHash!==proof.blockHash)invalid();
  nativeQuantity(receipt.transactionIndex);
  const native=nativeTransferFields(receipt.ynxNativeTransaction,expected);
  if(!Number.isSafeInteger(expected.amount)||expected.amount<=0||expected.fee!==1||!Number.isSafeInteger(expected.nonce)||expected.nonce<1||expected.type!=="transfer"||expected.chainId!==6423||native.type!=="transfer"||decimal(native.amountYNXT)!==BigInt(expected.amount)||decimal(native.feeYNXT)!==1n||nativeQuantity(native.nonce,true)!==BigInt(expected.nonce))invalid();
  // Legacy adapter-disabled gas is only an Ethereum projection. Native JSON
  // amounts, fee and nonce are proven by these exact ledger fields, not gas/wei.
  return Object.freeze({transactionHash:expectedHash,from:receipt.from,to:receipt.to,status:"0x1",contractAddress:null,transactionIndex:receipt.transactionIndex,blockNumber:proof.blockNumber,blockHash:proof.blockHash,ynxDurability:proof,ynxNativeTransaction:Object.freeze({...native})});
}
export function createNativeDurabilityEvidence(origin:string,capability:unknown,receipt:unknown,expected:SignedNativeTransfer,expectedHash:string):Readonly<Record<string,unknown>>{
  return Object.freeze({version:1,origin,chainId:"0x1917",capability:parseNativeDurabilityModel(capability),receipt:parseNativeDurableReceipt(receipt,expected,expectedHash)});
}
export function verifyNativeDurability(value:unknown,expected:SignedNativeTransfer,expectedHash:string,expectedOrigin:string):boolean{
  try{const evidence=exact(value,["version","origin","chainId","capability","receipt"]);if(evidence.version!==1||evidence.origin!==expectedOrigin||evidence.chainId!=="0x1917")return false;parseNativeDurabilityModel(evidence.capability);parseNativeDurableReceipt(evidence.receipt,expected,expectedHash);return true}catch{return false}
}
