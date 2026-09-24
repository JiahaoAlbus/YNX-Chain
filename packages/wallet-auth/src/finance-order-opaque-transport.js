import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { walletIdentity, walletIdentityFromPublicKey } from "./crypto.js";
import { parseFinanceOrderApprovalUnsigned, parseSignedFinanceOrderApproval, parseSignedFinanceOrderApprovalRevocation, verifySignedFinanceOrderApproval, verifySignedFinanceOrderApprovalRevocationAgainstUnsigned } from "./finance-order-approval.js";

export const FINANCE_ORDER_OPAQUE_LAUNCH_ROUTE="ynxwallet://finance-order-approval";
export const FINANCE_ORDER_OPAQUE_CALLBACK="https://finance.ynxweb4.com/wallet-auth/callback";
export const FINANCE_ORDER_OPAQUE_CLAIM_PATH="/api/broker/order-handoff/claim";
export const FINANCE_ORDER_OPAQUE_COMPLETE_PATH="/api/broker/order-handoff/complete";
export const FINANCE_ORDER_OPAQUE_EXCHANGE_PATH="/api/broker/order-handoff/exchange";
const TOKEN=/^[A-Za-z0-9_-]{32,64}$/;
const HEX64=/^[0-9a-f]{64}$/;
const ACCOUNT=/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/;
const PUBLIC=/^(02|03)[0-9a-f]{64}$/;
const CLAIM=["version","productId","origin","chainId","action","account","accountPublicKey","ticketHash","nonce","issuedAt","expiresAt"];
const REJECT=["version","productId","origin","chainId","action","account","accountPublicKey","ticketHash","requestId","challengeId","orderHash","callbackStateHash","issuedAt","expiresAt"];
const hash=value=>bytesToHex(sha256(utf8ToBytes(value)));
function fail(code,message){throw new WalletAuthError(code,message);}
function match(value,regex,label){if(typeof value!=="string"||!regex.test(value))fail("INVALID_FIELD",label+" invalid");return value;}
function time(value,label){match(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,label);if(!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail("INVALID_TIME",label+" invalid");return value;}
function active(start,end,at,maxMs){if(!(at instanceof Date)||!Number.isFinite(at.getTime()))fail("INVALID_TIME","Trusted clock required");const a=Date.parse(time(start,"issuedAt")),b=Date.parse(time(end,"expiresAt"));if(b<=a||b-a>maxMs||a>at.getTime()||b<=at.getTime())fail("EXPIRED","Proof not active");}
function secretKey(value){match(value,HEX64,"accountSecret");const bytes=hexToBytes(value);if(!secp256k1.utils.isValidSecretKey(bytes))fail("INVALID_SECRET","Account secret invalid");return bytes;}
function sign(unsigned,accountSecret,domain){
  const secret=secretKey(accountSecret);
  try{const identity=walletIdentity(accountSecret);if(identity.account!==unsigned.account||identity.accountPublicKey!==unsigned.accountPublicKey)fail("ACCOUNT_MISMATCH","Selected account changed");
    return Object.freeze({...unsigned,signature:bytesToHex(secp256k1.sign(sha256(utf8ToBytes(domain+"\n"+canonicalJSON(unsigned))),secret,{prehash:false,format:"compact",lowS:true}))});
  }finally{secret.fill(0);}
}
function verify(proof,unsigned,domain){
  if(canonicalJSON(Object.fromEntries(Object.entries(proof).filter(([key])=>key!=="signature")))!==canonicalJSON(unsigned))fail("BINDING_MISMATCH","Proof differs from expected ticket and account");
  let valid=false;try{valid=secp256k1.verify(hexToBytes(proof.signature),sha256(utf8ToBytes(domain+"\n"+canonicalJSON(unsigned))),hexToBytes(unsigned.accountPublicKey),{prehash:false,format:"compact",lowS:true})&&walletIdentityFromPublicKey(unsigned.accountPublicKey)===unsigned.account;}catch{}
  if(!valid)fail("INVALID_SIGNATURE","YNX Wallet signature invalid");
}
export function createFinanceOrderOpaqueLaunchURL(ticket){return FINANCE_ORDER_OPAQUE_LAUNCH_ROUTE+"?ticket="+match(ticket,TOKEN,"ticket");}
export function parseFinanceOrderOpaqueLaunchURL(url){
  if(typeof url!=="string"||!url.startsWith(FINANCE_ORDER_OPAQUE_LAUNCH_ROUTE+"?ticket="))fail("INVALID_ROUTE","Opaque Finance route required");
  const ticket=url.slice((FINANCE_ORDER_OPAQUE_LAUNCH_ROUTE+"?ticket=").length);
  if(url!==createFinanceOrderOpaqueLaunchURL(ticket))fail("INVALID_ROUTE","Opaque Finance route changed");
  return Object.freeze({ticket});
}
export function financeOrderOpaqueTicketHash(ticket){return hash("YNX_FINANCE_ORDER_TICKET_V2\n"+match(ticket,TOKEN,"ticket"));}
function parseClaimUnsigned(input){
  exactFields(input,CLAIM,"Finance opaque claim");
  const value=Object.freeze({version:input.version,productId:input.productId,origin:input.origin,chainId:input.chainId,action:input.action,
    account:match(input.account,ACCOUNT,"account"),accountPublicKey:match(input.accountPublicKey,PUBLIC,"accountPublicKey"),
    ticketHash:match(input.ticketHash,HEX64,"ticketHash"),nonce:match(input.nonce,TOKEN,"nonce"),issuedAt:time(input.issuedAt,"issuedAt"),expiresAt:time(input.expiresAt,"expiresAt")});
  if(value.version!=="2"||value.productId!=="finance"||value.origin!=="https://finance.ynxweb4.com"||value.chainId!=="0x1917"||value.action!=="claim-order-review")fail("BINDING_MISMATCH","Claim domain invalid");
  if(Date.parse(value.expiresAt)-Date.parse(value.issuedAt)>60_000||Date.parse(value.expiresAt)<=Date.parse(value.issuedAt))fail("INVALID_EXPIRY","Claim exceeds 60 seconds");
  return value;
}
export function financeOrderOpaqueClaimMessage(input){return "YNX_FINANCE_ORDER_TICKET_CLAIM_V2\n"+canonicalJSON(parseClaimUnsigned(input));}
export function createSignedFinanceOrderOpaqueClaim(input){
  exactFields(input,["ticket","accountSecret","nonce","issuedAt","expiresAt"],"Finance opaque claim input");
  const identity=walletIdentity(input.accountSecret);
  const unsigned=parseClaimUnsigned({version:"2",productId:"finance",origin:"https://finance.ynxweb4.com",chainId:"0x1917",
    action:"claim-order-review",account:identity.account,accountPublicKey:identity.accountPublicKey,ticketHash:financeOrderOpaqueTicketHash(input.ticket),
    nonce:input.nonce,issuedAt:input.issuedAt,expiresAt:input.expiresAt});
  return sign(unsigned,input.accountSecret,"YNX_FINANCE_ORDER_TICKET_CLAIM_V2");
}
export function verifyFinanceOrderOpaqueClaim(proofInput,expected,at){
  exactFields(proofInput,[...CLAIM,"signature"],"Signed Finance opaque claim");
  exactFields(expected,["ticket","account","accountPublicKey"],"Finance opaque claim authority");
  const {signature,...body}=proofInput,unsigned=parseClaimUnsigned(body);
  if(unsigned.ticketHash!==financeOrderOpaqueTicketHash(expected.ticket)||unsigned.account!==expected.account||unsigned.accountPublicKey!==expected.accountPublicKey)fail("BINDING_MISMATCH","Claim ticket or account changed");
  active(unsigned.issuedAt,unsigned.expiresAt,at,60_000);
  const proof=Object.freeze({...unsigned,signature:match(signature,/^[0-9a-f]{128}$/,"signature")});
  verify(proof,unsigned,"YNX_FINANCE_ORDER_TICKET_CLAIM_V2");
  return Object.freeze({verified:true,ticketHash:unsigned.ticketHash,account:unsigned.account,nonce:unsigned.nonce,expiresAt:unsigned.expiresAt});
}
export function createSignedFinanceOrderOpaqueReject(input,at,accountSecret){
  exactFields(input,["ticket","challenge"],"Finance opaque reject input");
  const challenge=parseFinanceOrderApprovalUnsigned(input.challenge),identity=walletIdentity(accountSecret);
  if(identity.account!==challenge.account||identity.accountPublicKey!==challenge.accountPublicKey)fail("ACCOUNT_MISMATCH","Selected account changed");
  active(challenge.issuedAt,challenge.expiresAt,at,300_000);
  const unsigned=parseRejectUnsigned({version:"2",productId:"finance",origin:"https://finance.ynxweb4.com",chainId:"0x1917",action:"reject",
    account:identity.account,accountPublicKey:identity.accountPublicKey,ticketHash:financeOrderOpaqueTicketHash(input.ticket),
    requestId:challenge.requestId,challengeId:challenge.challengeId,orderHash:challenge.orderHash,callbackStateHash:challenge.callbackStateHash,
    issuedAt:at.toISOString(),expiresAt:challenge.expiresAt});
  return sign(unsigned,accountSecret,"YNX_FINANCE_ORDER_REJECT_V2");
}
function parseRejectUnsigned(input){
  exactFields(input,REJECT,"Finance opaque rejection");
  const value=Object.freeze({version:input.version,productId:input.productId,origin:input.origin,chainId:input.chainId,action:input.action,
    account:match(input.account,ACCOUNT,"account"),accountPublicKey:match(input.accountPublicKey,PUBLIC,"accountPublicKey"),
    ticketHash:match(input.ticketHash,HEX64,"ticketHash"),requestId:match(input.requestId,/^request_[0-9a-f-]{36}$/,"requestId"),
    challengeId:match(input.challengeId,/^challenge_[0-9a-f-]{36}$/,"challengeId"),orderHash:match(input.orderHash,HEX64,"orderHash"),
    callbackStateHash:match(input.callbackStateHash,HEX64,"callbackStateHash"),issuedAt:time(input.issuedAt,"issuedAt"),expiresAt:time(input.expiresAt,"expiresAt")});
  if(value.version!=="2"||value.productId!=="finance"||value.origin!=="https://finance.ynxweb4.com"||value.chainId!=="0x1917"||value.action!=="reject")fail("BINDING_MISMATCH","Rejection domain invalid");
  return value;
}
export function verifySignedFinanceOrderOpaqueReject(proofInput,ticket,challengeInput,at){
  exactFields(proofInput,[...REJECT,"signature"],"Signed Finance opaque rejection");
  const challenge=parseFinanceOrderApprovalUnsigned(challengeInput),{signature,...body}=proofInput,unsigned=parseRejectUnsigned(body);
  if(unsigned.ticketHash!==financeOrderOpaqueTicketHash(ticket)||unsigned.account!==challenge.account||unsigned.accountPublicKey!==challenge.accountPublicKey||
    unsigned.requestId!==challenge.requestId||unsigned.challengeId!==challenge.challengeId||unsigned.orderHash!==challenge.orderHash||
    unsigned.callbackStateHash!==challenge.callbackStateHash||unsigned.expiresAt!==challenge.expiresAt)fail("BINDING_MISMATCH","Rejection differs from authoritative order");
  active(challenge.issuedAt,challenge.expiresAt,at,300_000);active(unsigned.issuedAt,unsigned.expiresAt,at,300_000);
  const proof=Object.freeze({...unsigned,signature:match(signature,/^[0-9a-f]{128}$/,"signature")});
  verify(proof,unsigned,"YNX_FINANCE_ORDER_REJECT_V2");
  return Object.freeze({verified:true,status:"rejected",requestId:challenge.requestId,ticketHash:unsigned.ticketHash});
}
export function createFinanceOrderOpaqueCallbackURL(input){
  exactFields(input,["code","state","requestId","callbackStateHash"],"Finance opaque callback");
  const code=match(input.code,TOKEN,"code"),state=match(input.state,TOKEN,"state");
  match(input.requestId,/^request_[0-9a-f-]{36}$/,"requestId");
  if(hash(state)!==match(input.callbackStateHash,HEX64,"callbackStateHash"))fail("STATE_MISMATCH","Callback state changed");
  return FINANCE_ORDER_OPAQUE_CALLBACK+"?financeOrderCode="+code+"&state="+state;
}
export function parseFinanceOrderOpaqueCallbackURL(url,expected){
  if(typeof url!=="string")fail("INVALID_CALLBACK","Callback URL invalid");
  let parsed;try{parsed=new URL(url);}catch{fail("INVALID_CALLBACK","Callback URL invalid");}
  if(parsed.origin!=="https://finance.ynxweb4.com"||parsed.pathname!=="/wallet-auth/callback"||parsed.hash||
    [...parsed.searchParams.keys()].join(",")!=="financeOrderCode,state")fail("INVALID_CALLBACK","Callback route or fields changed");
  const code=match(parsed.searchParams.get("financeOrderCode"),TOKEN,"code"),state=match(parsed.searchParams.get("state"),TOKEN,"state");
  if(url!==createFinanceOrderOpaqueCallbackURL({code,state,...expected}))fail("INVALID_CALLBACK","Callback is noncanonical");
  return Object.freeze({code,state,requestId:expected.requestId});
}
export function parseFinanceOrderOpaqueClaimResponse(input,expected){
  exactFields(input,["version","ticketHash","challenge","serverTime"],"Finance opaque claim response");
  exactFields(expected,["ticket","account","accountPublicKey"],"Finance opaque claim response authority");
  if(input.version!=="2"||input.ticketHash!==financeOrderOpaqueTicketHash(expected.ticket))fail("BINDING_MISMATCH","Claim response ticket changed");
  const challenge=parseFinanceOrderApprovalUnsigned(input.challenge);
  if(challenge.account!==expected.account||challenge.accountPublicKey!==expected.accountPublicKey)fail("ACCOUNT_MISMATCH","Claim response account changed");
  const serverTime=time(input.serverTime,"serverTime");
  active(challenge.issuedAt,challenge.expiresAt,new Date(serverTime),300_000);
  return Object.freeze({version:"2",ticketHash:input.ticketHash,challenge,serverTime});
}
export function createFinanceOrderOpaqueCompleteRequest(ticket,status,proof,challengeInput,at){
  const challenge=parseFinanceOrderApprovalUnsigned(challengeInput);
  const ticketHash=financeOrderOpaqueTicketHash(ticket);
  let verified;
  if(status==="approved") verified=verifySignedFinanceOrderApproval(proof,challenge,at);
  else if(status==="rejected"){verifySignedFinanceOrderOpaqueReject(proof,ticket,challenge,at);verified=proof;}
  else if(status==="revoked") verified=verifySignedFinanceOrderApprovalRevocationAgainstUnsigned(proof,challenge,at);
  else fail("INVALID_DECISION","Unknown order decision");
  return Object.freeze({version:"2",ticket:match(ticket,TOKEN,"ticket"),ticketHash,requestId:challenge.requestId,status,proof:verified});
}
export function parseFinanceOrderOpaqueCompleteResponse(input,expected){
  exactFields(input,["version","ticketHash","requestId","status","code","state","expiresAt","serverTime"],"Finance opaque complete response");
  exactFields(expected,["ticket","challenge"],"Finance opaque complete response authority");
  const challenge=parseFinanceOrderApprovalUnsigned(expected.challenge);
  if(input.version!=="2"||input.status!=="stored"||input.ticketHash!==financeOrderOpaqueTicketHash(expected.ticket)||input.requestId!==challenge.requestId)
    fail("BINDING_MISMATCH","Stored order result differs from ticket or request");
  const callbackURL=createFinanceOrderOpaqueCallbackURL({code:input.code,state:input.state,requestId:input.requestId,callbackStateHash:challenge.callbackStateHash});
  const serverTime=time(input.serverTime,"serverTime"),expiresAt=time(input.expiresAt,"expiresAt");
  if(Date.parse(expiresAt)<=Date.parse(serverTime)||Date.parse(expiresAt)>Date.parse(challenge.expiresAt))fail("EXPIRED","Callback code expired or outlives challenge");
  return Object.freeze({version:"2",ticketHash:input.ticketHash,requestId:input.requestId,status:"stored",code:input.code,state:input.state,
    expiresAt,serverTime,callbackURL});
}
