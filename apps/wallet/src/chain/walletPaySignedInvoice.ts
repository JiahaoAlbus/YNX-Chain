import {ed25519} from "@noble/curves/ed25519.js";
import {hexToBytes} from "@noble/hashes/utils.js";
import {evmAddressFromYNX,ynxAddressFromEVM,type createPayInvoiceSignerPolicy} from "@ynx-chain/wallet-auth";

type Policy=ReturnType<typeof createPayInvoiceSignerPolicy>;
type Guard=()=>void;
type Fee=Readonly<{networkFee:number;providerCost:number;protocolFee:number;burn:number;treasury:number;merchantNet:number;sponsorCost:number;userRebate:number;source:string;asOf:string;version:1}>;
export type SignedPayInvoice=Readonly<{version:1|2|3|4|5;id:string;centralInvoiceId:string;intentId:string;merchantId:string;merchantName:string;payoutAddress:string;amount:number;asset:"YNXT";network:"ynx_6423-1";fee:1;feeBreakdown?:Fee;baseAmount?:number;tipAmount?:number;splitPaymentId?:string;splitShareId?:string;serviceBillId?:string;serviceEvidenceDigest?:string;expectedPayerHash?:string;expiresAt:string;createdAt:string;signature:string;signatureKeyId:string;signingPublicKey:string;signatureAlgorithm:"ed25519"}>;
export class SignedPayInvoiceError extends Error{constructor(readonly code:string){super(code);this.name="SignedPayInvoiceError"}}
const fail=(code="PAY_SIGNED_INVOICE_INVALID"):never=>{throw new SignedPayInvoiceError(code)};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function text(v:unknown,max=128):string{if(typeof v!=="string"||!v||v.trim()!==v||v.length>max||/[|\x00-\x1f\x7f]/.test(v))return fail();return v}
function natural(v:unknown,positive=false):number{if(typeof v!=="number"||!Number.isSafeInteger(v)||v<(positive?1:0))return fail();return v}
function hash(v:unknown,size:number):string{const value=text(v,size);if(!new RegExp(`^[a-f0-9]{${size}}$`).test(value))return fail();return value}
function date(v:unknown):string{const value=text(v,40),parsed=Date.parse(value);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,19)!==value.slice(0,19))return fail();return value}
function patterned(v:unknown,pattern:RegExp):string{const value=text(v);if(!pattern.test(value))return fail();return value}
const invoiceID=(v:unknown)=>patterned(v,/^inv_[a-f0-9]{20}$/);
function fee(v:unknown):Fee{if(!object(v)||v.version!==1)return fail();return Object.freeze({networkFee:natural(v.networkFee),providerCost:natural(v.providerCost),protocolFee:natural(v.protocolFee),burn:natural(v.burn),treasury:natural(v.treasury),merchantNet:natural(v.merchantNet,true),sponsorCost:natural(v.sponsorCost),userRebate:natural(v.userRebate),source:text(v.source),asOf:date(v.asOf),version:1})}

/** Exact original Pay signature material at 53eb677c0e41d1ddf73d7faa105958181dc29236.
 * Status/settlement/description are not signed by this wire and are deliberately
 * NOT returned as trusted fields. Nothing here owns a key, session or outbox. */
export function parseSignedPayInvoice(value:unknown,expectedInvoiceID:string):SignedPayInvoice{
  if(!object(value)||![1,2,3,4,5].includes(Number(value.version))||typeof value.version!=="number"||value.asset!=="YNXT"||value.network!=="ynx_6423-1"||value.fee!==1||value.signatureAlgorithm!=="ed25519")return fail();
  const version=value.version as SignedPayInvoice["version"],id=invoiceID(value.id);
  if(id!==invoiceID(expectedInvoiceID))return fail("PAY_SIGNED_INVOICE_ID_MISMATCH");
  const payoutAddress=text(value.payoutAddress);
  try{if(ynxAddressFromEVM(evmAddressFromYNX(payoutAddress))!==payoutAddress)return fail()}catch{return fail()}
  const amount=natural(value.amount,true);if(!Number.isSafeInteger(amount+1))return fail();
  const fees=version>=2?fee(value.feeBreakdown):undefined;
  if(fees&&(fees.networkFee!==1||fees.merchantNet!==amount))return fail("PAY_SIGNED_FEE_MISMATCH");
  const baseAmount=version>=3?natural(value.baseAmount,true):undefined,tipAmount=version>=3?natural(value.tipAmount):undefined;
  if(baseAmount!==undefined&&tipAmount!==undefined&&(baseAmount+tipAmount!==amount||tipAmount>baseAmount))return fail("PAY_SIGNED_TIP_MISMATCH");
  const createdAt=date(value.createdAt),expiresAt=date(value.expiresAt);if(Date.parse(expiresAt)<=Date.parse(createdAt))return fail();
  return Object.freeze({version,id,centralInvoiceId:text(value.centralInvoiceId),intentId:text(value.intentId),merchantId:text(value.merchantId),merchantName:text(value.merchantName,256),payoutAddress,amount,asset:"YNXT",network:"ynx_6423-1",fee:1,
    ...(fees?{feeBreakdown:fees}:{}),...(baseAmount===undefined?{}:{baseAmount,tipAmount:tipAmount!}),
    ...(version===4?{splitPaymentId:patterned(value.splitPaymentId,/^spl_[a-f0-9]{20}$/),splitShareId:patterned(value.splitShareId,/^shr_[a-f0-9]{16}$/)}:{}),
    ...(version===5?{serviceBillId:patterned(value.serviceBillId,/^qbl_[a-f0-9]{20}$/),serviceEvidenceDigest:hash(value.serviceEvidenceDigest,64)}:{}),
    ...(version===4||version===5?{expectedPayerHash:hash(value.expectedPayerHash,64)}:{}),createdAt,expiresAt,signature:hash(value.signature,128),signatureKeyId:text(value.signatureKeyId),signingPublicKey:hash(value.signingPublicKey,64),signatureAlgorithm:"ed25519"});
}
export function signedPayInvoiceMaterial(invoice:SignedPayInvoice):string{
  const v=parseSignedPayInvoice(invoice,invoice.id),base=[String(v.version),v.id,v.centralInvoiceId,v.intentId,v.merchantId,v.merchantName,v.payoutAddress,String(v.amount),v.asset,v.network,String(v.fee)];
  const fees=v.feeBreakdown;
  const feeParts=fees?[String(fees.networkFee),String(fees.providerCost),String(fees.protocolFee),String(fees.burn),String(fees.treasury),String(fees.merchantNet),String(fees.sponsorCost),String(fees.userRebate),fees.source,fees.asOf,String(fees.version)]:[];
  const tail=[v.expiresAt,v.createdAt,v.signatureKeyId,v.signingPublicKey,v.signatureAlgorithm];
  return [`YNX_PAY_INVOICE_V${v.version}`,...base,...feeParts,...(v.version>=3?[String(v.baseAmount),String(v.tipAmount)]:[]),...tail,
    ...(v.version===4?[v.splitPaymentId!,v.splitShareId!,v.expectedPayerHash!]:[]),...(v.version===5?[v.serviceBillId!,v.serviceEvidenceDigest!,v.expectedPayerHash!]:[])].join("|");
}
/** Policy MUST come from protected operator/provenance-verified release input,
 * never invoice, QR or merchant response. This result is signature-only: an
 * account-bound Pay session, current quote/status, review, original transfer and
 * settlement remain separate mandatory gates before any payment is possible. */
export function verifySignedPayInvoice(value:unknown,expectedInvoiceID:string,policy:Policy,guard:Guard,now=Date.now()){
  guard();const invoice=parseSignedPayInvoice(value,expectedInvoiceID);
  if(!policy||typeof policy.resolve!=="function")return fail("PAY_SIGNED_TRUST_POLICY_REQUIRED");
  const signer=policy.resolve({signatureKeyId:invoice.signatureKeyId,signingPublicKey:invoice.signingPublicKey,signatureAlgorithm:invoice.signatureAlgorithm,merchantId:invoice.merchantId});
  if(signer.keyId!==invoice.signatureKeyId||signer.publicKey!==invoice.signingPublicKey||signer.algorithm!=="ed25519")return fail("PAY_SIGNED_SIGNER_MISMATCH");
  let valid=false;try{valid=ed25519.verify(hexToBytes(invoice.signature),new TextEncoder().encode(signedPayInvoiceMaterial(invoice)),hexToBytes(signer.publicKey))}catch{}
  if(!valid)return fail("PAY_SIGNED_SIGNATURE_INVALID");guard();
  if(!Number.isSafeInteger(now)||now<0||now>8_640_000_000_000_000)return fail();
  return Object.freeze({invoice,signatureVerified:true as const,checkedAt:new Date(now).toISOString(),quoteTimeCurrent:Date.parse(invoice.createdAt)<=now&&now<Date.parse(invoice.expiresAt),
    paymentAuthorized:false as const,accountSessionVerified:false as const,settlementVerified:false as const,truthfulStatus:"pinned-merchant-signature-only-not-payment-authorization" as const});
}
