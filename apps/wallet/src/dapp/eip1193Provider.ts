import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Signature, Transaction, TypedDataEncoder, getBytes, hashMessage, hexlify } from "ethers";
import { evmAddressFromYNX } from "@ynx-chain/wallet-auth";

export const YNX_EVM_CHAIN_ID=6423;
export const YNX_EVM_CHAIN_QUANTITY="0x1917";
export const YNX_EVM_CAIP2="eip155:6423";
export const SHARED_PROVIDER_AUTHORITY=Object.freeze({sourceCommit:"98c6d5d784d212df8981a53b17118a511e246ad2",sourceTree:"51a60a362d4ad5dd748bcdefb101f71b1d9e0cee",evidenceCommit:"c3ab255c32bdeb9c8e056882c315f8ad43c29c7f"});

export const EIP1193_METHODS=Object.freeze(["eth_accounts","eth_requestAccounts","eth_chainId","net_version","personal_sign","eth_signTypedData_v4","eth_sendTransaction"] as const);
export const EIP1193_EVENTS=Object.freeze(["accountsChanged","chainChanged"] as const);
export type Eip1193Transport="walletconnect-v2"|"dapp-browser";
export type Eip1193Method=(typeof EIP1193_METHODS)[number];

export type Eip1193Session=Readonly<{
  sessionId:string;transport:Eip1193Transport;origin:string;name:string;account:string;caip10Account:string;
  methods:readonly Eip1193Method[];events:readonly string[];expiresAt:string;productSession:false;privateService:"not-requested";
  authority:"standard-wallet-eip1193-provider";
}>;

export type Eip1193Request=Readonly<{
  sessionId:string;requestId:string;transport:Eip1193Transport;origin:string;chainId:typeof YNX_EVM_CAIP2;method:Eip1193Method;
  params:readonly unknown[];account:string;issuedAt:string;expiresAt:string;review:Readonly<{title:string;origin:string;account:string;network:string;details:readonly string[]}>;
}>;

export function approveEip1193Session(input:unknown,selectedYNXAccount:string,now=new Date()):Eip1193Session{
  const value=record(input,"DApp session proposal");exact(value,["sessionId","transport","origin","name","chains","methods","events","expiresAt"],"DApp session proposal");
  const sessionId=token(value.sessionId,"session ID"),transport=parseTransport(value.transport),origin=parseOrigin(value.origin),name=text(value.name,"DApp name",1,96);
  const chains=strings(value.chains,"DApp chains",1,8);if(chains.length!==1||chains[0]!==YNX_EVM_CAIP2)fail("UNSUPPORTED_CHAIN","DApp session must request only YNX EVM chain eip155:6423");
  const methods=strings(value.methods,"DApp methods",1,EIP1193_METHODS.length) as Eip1193Method[];unique(methods,"DApp methods");if(methods.some(item=>!EIP1193_METHODS.includes(item)))fail("UNSUPPORTED_METHOD","DApp session requested an unsupported EIP-1193 method");
  const events=strings(value.events,"DApp events",0,EIP1193_EVENTS.length);unique(events,"DApp events");if(events.some(item=>!EIP1193_EVENTS.includes(item as typeof EIP1193_EVENTS[number])))fail("UNSUPPORTED_EVENT","DApp session requested an unsupported event");
  const expiresAt=time(value.expiresAt,"DApp session expiry"),at=validNow(now);if(expiresAt.getTime()<=at.getTime()||expiresAt.getTime()>at.getTime()+7*24*60*60*1000)fail("INVALID_EXPIRY","DApp session expiry must be within seven days");
  const account=evmAddressFromYNX(selectedYNXAccount).toLowerCase();
  return Object.freeze({sessionId,transport,origin,name,account,caip10Account:`${YNX_EVM_CAIP2}:${account}`,methods:Object.freeze([...methods].sort()),events:Object.freeze([...events].sort()),expiresAt:expiresAt.toISOString(),productSession:false,privateService:"not-requested",authority:"standard-wallet-eip1193-provider"});
}

export function parseEip1193Request(input:unknown,session:Eip1193Session,now=new Date()):Eip1193Request{
  assertSession(session,now);const value=record(input,"EIP-1193 request");exact(value,["sessionId","requestId","transport","origin","chainId","method","params","issuedAt","expiresAt"],"EIP-1193 request");
  if(value.sessionId!==session.sessionId||value.transport!==session.transport||value.origin!==session.origin||value.chainId!==YNX_EVM_CAIP2)fail("SESSION_BINDING_MISMATCH","EIP-1193 request differs from its approved session");
  const requestId=id(value.requestId),method=methodValue(value.method);if(!session.methods.includes(method))fail("METHOD_NOT_APPROVED","EIP-1193 method was not approved for this session");
  if(!Array.isArray(value.params)||value.params.length>4)fail("INVALID_PARAMS","EIP-1193 params are invalid");const params=Object.freeze([...value.params]);
  const issued=time(value.issuedAt,"request issue time"),expires=time(value.expiresAt,"request expiry"),at=validNow(now);if(issued.getTime()>at.getTime()+30_000||expires.getTime()<=at.getTime()||expires.getTime()<=issued.getTime()||expires.getTime()>issued.getTime()+5*60_000||expires.getTime()>Date.parse(session.expiresAt))fail("INVALID_EXPIRY","EIP-1193 request lifetime is invalid");
  const details=validateParams(method,params,session.account);return Object.freeze({sessionId:session.sessionId,requestId,transport:session.transport,origin:session.origin,chainId:YNX_EVM_CAIP2,method,params,account:session.account,issuedAt:issued.toISOString(),expiresAt:expires.toISOString(),review:Object.freeze({title:reviewTitle(method),origin:session.origin,account:session.account,network:"YNX Testnet · 6423 · 0x1917 · YNXT",details:Object.freeze(details)})});
}

export function restoreEip1193Session(input:unknown,selectedYNXAccount:string,now=new Date()):Eip1193Session{
  const value=record(input,"Persisted DApp session");exact(value,["sessionId","transport","origin","name","account","caip10Account","methods","events","expiresAt","productSession","privateService","authority"],"Persisted DApp session");
  const restored=approveEip1193Session({sessionId:value.sessionId,transport:value.transport,origin:value.origin,name:value.name,chains:[YNX_EVM_CAIP2],methods:value.methods,events:value.events,expiresAt:value.expiresAt},selectedYNXAccount,now);
  if(JSON.stringify(value)!==JSON.stringify(restored))fail("SESSION_RESTORE_MISMATCH","Persisted DApp session failed canonical verification");return restored;
}

export function restoreEip1193Request(input:unknown,session:Eip1193Session,now=new Date()):Eip1193Request{
  const value=record(input,"Persisted EIP-1193 request");exact(value,["sessionId","requestId","transport","origin","chainId","method","params","account","issuedAt","expiresAt","review"],"Persisted EIP-1193 request");
  const restored=parseEip1193Request({sessionId:value.sessionId,requestId:restoredWireId(value.requestId),transport:value.transport,origin:value.origin,chainId:value.chainId,method:value.method,params:value.params,issuedAt:value.issuedAt,expiresAt:value.expiresAt},session,now);
  if(JSON.stringify(value)!==JSON.stringify(restored))fail("REQUEST_RESTORE_MISMATCH","Persisted EIP-1193 request failed canonical verification");return restored;
}

export function answerEip1193Read(request:Eip1193Request):unknown{
  if(request.method==="eth_accounts"||request.method==="eth_requestAccounts")return Object.freeze([request.account]);
  if(request.method==="eth_chainId")return YNX_EVM_CHAIN_QUANTITY;
  if(request.method==="net_version")return String(YNX_EVM_CHAIN_ID);
  fail("USER_APPROVAL_REQUIRED","Signing and transaction requests require explicit Wallet approval");
}

export async function approveAndSignEip1193Request(request:Eip1193Request,boundary:Readonly<{authorize:(method:Eip1193Method)=>Promise<unknown>;readAccountSecret:(account:string)=>Promise<string>;assertActive:()=>void;now?:()=>Date}>):Promise<string>{
  if(!boundary||typeof boundary.authorize!=="function"||typeof boundary.readAccountSecret!=="function"||typeof boundary.assertActive!=="function")fail("INVALID_APPROVAL_BOUNDARY","EIP-1193 signing requires an explicit Wallet approval boundary");const now=boundary.now??(()=>new Date());assertRequestActive(request,now());boundary.assertActive();await boundary.authorize(request.method);assertRequestActive(request,now());boundary.assertActive();const secret=await boundary.readAccountSecret(request.account);assertRequestActive(request,now());boundary.assertActive();const result=signApprovedEip1193Request(request,secret);assertRequestActive(request,now());boundary.assertActive();return result;
}

function signApprovedEip1193Request(request:Eip1193Request,accountSecret:string):string{
  if(request.method==="personal_sign"){const message=request.params[0] as string;return withSecret(accountSecret,request.account,secret=>ethereumSignature(getBytes(hashMessage(getBytes(message))),secret));}
  if(request.method==="eth_signTypedData_v4"){const typed=parseTypedData(request.params[1]);const types=Object.fromEntries(Object.entries(typed.types).filter(([name])=>name!=="EIP712Domain").map(([name,fields])=>[name,fields.map(field=>({...field}))]));const digest=getBytes(TypedDataEncoder.hash(typed.domain,types,typed.message));return withSecret(accountSecret,request.account,secret=>ethereumSignature(digest,secret));}
  if(request.method==="eth_sendTransaction"){const tx=parseTransaction(request.params[0],request.account);const unsigned=Transaction.from(tx);const signature=withSecret(accountSecret,request.account,secret=>Signature.from(ethereumSignature(getBytes(unsigned.unsignedHash),secret)));unsigned.signature=signature;return unsigned.serialized;}
  fail("METHOD_NOT_SIGNABLE","EIP-1193 request does not require a signature");
}

function validateParams(method:Eip1193Method,params:readonly unknown[],account:string):string[]{
  if(method==="eth_accounts"||method==="eth_requestAccounts"||method==="eth_chainId"||method==="net_version"){if(params.length!==0)fail("INVALID_PARAMS",`${method} does not accept params`);return["Read only; no signature or transaction."];}
  if(method==="personal_sign"){if(params.length!==2||canonicalHex(params[0],"message",128*1024)===null||address(params[1])!==account)fail("ACCOUNT_MISMATCH","personal_sign must target the approved account");return[`Message bytes: ${((params[0] as string).length-2)/2}`,"EIP-191 personal message; not a transaction."];}
  if(method==="eth_signTypedData_v4"){if(params.length!==2||address(params[0])!==account)fail("ACCOUNT_MISMATCH","EIP-712 request must target the approved account");const typed=parseTypedData(params[1]);return[`Primary type: ${typed.primaryType}`,`Domain: ${typed.domain.name??"Unnamed"}`,`Verifying contract: ${typed.domain.verifyingContract??"Not specified"}`];}
  const tx=parseTransaction(params.length===1?params[0]:null,account);return[`To: ${tx.to}`,`Value: ${tx.value.toString()} wei`,`Max gas: ${tx.gasLimit.toString()}`,`Max fee per gas: ${tx.maxFeePerGas.toString()} wei`];
}

function parseTypedData(value:unknown):{domain:Record<string,unknown>;types:Record<string,readonly {name:string;type:string}[]>;primaryType:string;message:Record<string,unknown>}{
  if(typeof value!=="string"||value.length>256*1024)fail("INVALID_TYPED_DATA","EIP-712 payload must be bounded JSON text");let parsed:unknown;try{parsed=JSON.parse(value)}catch{fail("INVALID_TYPED_DATA","EIP-712 payload is unreadable")};const input=record(parsed,"EIP-712 payload");exact(input,["domain","types","primaryType","message"],"EIP-712 payload");const domain=record(input.domain,"EIP-712 domain"),typesValue=record(input.types,"EIP-712 types"),message=record(input.message,"EIP-712 message"),primaryType=text(input.primaryType,"EIP-712 primary type",1,64);if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(primaryType))fail("INVALID_TYPED_DATA","EIP-712 primary type is invalid");
  const chain=domain.chainId;if(chain!==YNX_EVM_CHAIN_ID&&chain!==YNX_EVM_CHAIN_QUANTITY&&chain!==String(YNX_EVM_CHAIN_ID))fail("UNSUPPORTED_CHAIN","EIP-712 domain must bind chain 6423");if(domain.verifyingContract!==undefined)address(domain.verifyingContract);
  const entries=Object.entries(typesValue);if(entries.length<1||entries.length>64)fail("INVALID_TYPED_DATA","EIP-712 type count is invalid");const types:Record<string,readonly {name:string;type:string}[]>={};for(const [name,fields] of entries){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||!Array.isArray(fields)||fields.length>64)fail("INVALID_TYPED_DATA","EIP-712 type definition is invalid");types[name]=Object.freeze(fields.map(field=>{const item=record(field,"EIP-712 field");exact(item,["name","type"],"EIP-712 field");return Object.freeze({name:text(item.name,"EIP-712 field name",1,64),type:text(item.type,"EIP-712 field type",1,128)})}));}
  return{domain,types,primaryType,message};
}

function parseTransaction(value:unknown,account:string){const tx=record(value,"EVM transaction");exact(tx,["from","to","chainId","nonce","gas","maxFeePerGas","maxPriorityFeePerGas","value","data","type"],"EVM transaction");if(address(tx.from)!==account)fail("ACCOUNT_MISMATCH","EVM transaction must use the approved account");const to=address(tx.to),chainId=quantity(tx.chainId,"chainId"),nonce=quantity(tx.nonce,"nonce"),gasLimit=quantity(tx.gas,"gas"),maxFeePerGas=quantity(tx.maxFeePerGas,"maxFeePerGas"),maxPriorityFeePerGas=quantity(tx.maxPriorityFeePerGas,"maxPriorityFeePerGas"),valueWei=quantity(tx.value,"value");if(chainId!==BigInt(YNX_EVM_CHAIN_ID)||tx.type!=="0x2")fail("UNSUPPORTED_CHAIN","EVM transaction must be EIP-1559 on chain 6423");if(nonce>BigInt(Number.MAX_SAFE_INTEGER)||gasLimit===0n||maxFeePerGas<maxPriorityFeePerGas)fail("INVALID_TRANSACTION","EVM transaction fee or nonce is invalid");const data=canonicalHex(tx.data,"calldata",128*1024);return{type:2,chainId:YNX_EVM_CHAIN_ID,to,nonce:Number(nonce),gasLimit,maxFeePerGas,maxPriorityFeePerGas,value:valueWei,data};}

function ethereumSignature(digest:Uint8Array,secret:Uint8Array):string{if(digest.length!==32)fail("INVALID_DIGEST","EVM signing digest must be 32 bytes");const recovered=secp256k1.sign(digest,secret,{prehash:false,lowS:true,format:"recovered"});return hexlify(Uint8Array.from([...recovered.slice(1),27+recovered[0]!]));}
function withSecret<T>(value:string,account:string,operation:(secret:Uint8Array)=>T):T{if(!/^[0-9a-f]{64}$/.test(value))fail("INVALID_SECRET","Wallet account secret is invalid");const secret=hexToBytes(value);try{if(!secp256k1.utils.isValidSecretKey(secret))fail("INVALID_SECRET","Wallet account secret is outside secp256k1 range");const publicKey=secp256k1.getPublicKey(secret,false),derived=`0x${bytesToHex(keccak_256(publicKey.slice(1)).slice(-20))}`;if(derived!==account)fail("ACCOUNT_MISMATCH","Wallet key does not match the approved DApp account");return operation(secret)}finally{secret.fill(0)}}
function assertSession(value:Eip1193Session,now:Date){if(value.authority!=="standard-wallet-eip1193-provider"||value.productSession!==false||value.privateService!=="not-requested"||value.account!==value.account.toLowerCase()||Date.parse(value.expiresAt)<=validNow(now).getTime())fail("INVALID_SESSION","DApp session is invalid or expired")}
function assertRequestActive(value:Eip1193Request,now:Date){if(!Object.isFrozen(value)||value.chainId!==YNX_EVM_CAIP2||value.account!==value.account.toLowerCase()||Date.parse(value.expiresAt)<=validNow(now).getTime())fail("REQUEST_EXPIRED","EIP-1193 signing request is invalid or expired")}
function reviewTitle(method:Eip1193Method){return({eth_accounts:"Share approved account",eth_requestAccounts:"Share approved account",eth_chainId:"Read chain ID",net_version:"Read network ID",personal_sign:"Sign message",eth_signTypedData_v4:"Sign typed data",eth_sendTransaction:"Sign and send transaction"})[method]}
function methodValue(value:unknown):Eip1193Method{if(typeof value!=="string"||!EIP1193_METHODS.includes(value as Eip1193Method))fail("UNSUPPORTED_METHOD","EIP-1193 method is unsupported");return value as Eip1193Method}
function parseTransport(value:unknown):Eip1193Transport{if(value!=="walletconnect-v2"&&value!=="dapp-browser")fail("INVALID_TRANSPORT","DApp transport is invalid");return value}
function parseOrigin(value:unknown){const input=text(value,"DApp origin",8,256);let url:URL;try{url=new URL(input)}catch{fail("INVALID_ORIGIN","DApp origin is invalid")};if(url.protocol!=="https:"||url.origin!==input||url.username||url.password||url.port)fail("INVALID_ORIGIN","DApp origin must be a canonical HTTPS origin");return input}
function address(value:unknown){if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value))fail("INVALID_ADDRESS","EVM address is invalid");return value.toLowerCase()}
function quantity(value:unknown,label:string){if(typeof value!=="string"||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value))fail("INVALID_TRANSACTION",`${label} must be a canonical hex quantity`);return BigInt(value)}
function canonicalHex(value:unknown,label:string,maxBytes:number):string{if(typeof value!=="string"||!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)||(value.length-2)/2>maxBytes)fail("INVALID_HEX",`${label} must be bounded even-length hex bytes`);return value.toLowerCase()}
function id(value:unknown){if(typeof value==="number"&&Number.isSafeInteger(value)&&value>=0)return`n:${value}`;if(typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value))return`s:${value}`;fail("INVALID_REQUEST_ID","EIP-1193 request ID is invalid")}
function restoredWireId(value:unknown){if(typeof value!=="string")fail("INVALID_REQUEST_ID","Persisted EIP-1193 request ID is invalid");if(/^n:(?:0|[1-9][0-9]{0,15})$/.test(value)){const parsed=Number(value.slice(2));if(Number.isSafeInteger(parsed))return parsed}if(/^s:[A-Za-z0-9_-]{1,128}$/.test(value))return value.slice(2);fail("INVALID_REQUEST_ID","Persisted EIP-1193 request ID is invalid")}
function token(value:unknown,label:string){if(typeof value!=="string"||!/^[A-Za-z0-9:_-]{16,160}$/.test(value))fail("INVALID_TOKEN",`${label} is invalid`);return value}
function text(value:unknown,label:string,min:number,max:number){if(typeof value!=="string"||value.trim()!==value||value.length<min||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail("INVALID_TEXT",`${label} is invalid`);return value}
function strings(value:unknown,label:string,min:number,max:number){if(!Array.isArray(value)||value.length<min||value.length>max||value.some(item=>typeof item!=="string"))fail("INVALID_LIST",`${label} is invalid`);return value as string[]}
function unique(value:readonly string[],label:string){if(new Set(value).size!==value.length)fail("INVALID_LIST",`${label} contains duplicates`)}
function time(value:unknown,label:string){if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value))fail("INVALID_TIME",`${label} is invalid`);const parsed=new Date(value);if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==value)fail("INVALID_TIME",`${label} is invalid`);return parsed}
function validNow(value:Date){if(!(value instanceof Date)||!Number.isFinite(value.getTime()))fail("INVALID_TIME","Current time is invalid");return value}
function record(value:unknown,label:string):Record<string,unknown>{if(typeof value!=="object"||value===null||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail("INVALID_SHAPE",`${label} must be a plain object`);return value as Record<string,unknown>}
function exact(value:Record<string,unknown>,fields:readonly string[],label:string){if(Object.keys(value).sort().join("\n")!==[...fields].sort().join("\n"))fail("INVALID_SHAPE",`${label} fields are not exact`)}
function fail(code:string,message:string):never{throw Object.assign(new Error(message),{code})}
