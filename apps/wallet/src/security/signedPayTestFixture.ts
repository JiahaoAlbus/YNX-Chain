import {ed25519} from "@noble/curves/ed25519.js";
import {p256} from "@noble/curves/nist.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {createPayInvoiceSignerPolicy,digestHex,parseProductSession,payPaymentIntentDigest,walletIdentity,ynxAddressFromEVM,evmAddressFromYNX} from "@ynx-chain/wallet-auth";
import {WalletOperationLifecycle} from "./operationLifecycle";
import {createHash} from "node:crypto";
// Synthetic protocol fixtures only; never a production authority adapter.
const seed="01".repeat(32),identity=walletIdentity(seed),merchantSeed=new Uint8Array(32).fill(11),publicKey=bytesToHex(ed25519.getPublicKey(merchantSeed));
const at=Date.parse("2026-10-03T01:00:00.000Z");
const policy=createPayInvoiceSignerPolicy({schemaVersion:"ynx-pay-invoice-signers/v1",signers:[{keyId:"controlled-key",publicKey,algorithm:"ed25519",merchantIds:["controlled-merchant"]}]});
export function signedPayFixture(version=1,expectedPayerHash?:string){
  let now=at,valid=true,refreshes=0,prompts=0,reads=0;
  const invoice:any={version,id:"inv_"+"a".repeat(20),centralInvoiceId:"controlled-central",intentId:"controlled-intent",merchantId:"controlled-merchant",merchantName:"Controlled merchant",payoutAddress:ynxAddressFromEVM("0x"+"2".repeat(40)),amount:25,asset:"YNXT",network:"ynx_6423-1",fee:1,expiresAt:"2026-10-03T02:00:00Z",createdAt:"2026-10-03T00:00:00Z",signature:"",signatureKeyId:"controlled-key",signingPublicKey:publicKey,signatureAlgorithm:"ed25519"};
  if(version>=2)invoice.feeBreakdown={networkFee:1,providerCost:0,protocolFee:0,burn:0,treasury:0,merchantNet:25,sponsorCost:0,userRebate:0,source:"controlled-fixture",asOf:"2026-10-03T00:00:00Z",version:1};
  if(version>=3){invoice.baseAmount=20;invoice.tipAmount=5;}
  if(version>=4)invoice.expectedPayerHash=expectedPayerHash??createHash("sha256").update(`YNX_PAY_EXPECTED_PAYER_V1|${identity.account}`).digest("hex");
  if(version===4){invoice.splitPaymentId="spl_"+"e".repeat(20);invoice.splitShareId="shr_"+"f".repeat(16);}
  if(version===5){invoice.serviceBillId="qbl_"+"e".repeat(20);invoice.serviceEvidenceDigest="f".repeat(64);}
  // Independent original merchant wire, not verifier serializer.
  const parts=[`YNX_PAY_INVOICE_V${version}`,version,invoice.id,invoice.centralInvoiceId,invoice.intentId,invoice.merchantId,invoice.merchantName,invoice.payoutAddress,invoice.amount,invoice.asset,invoice.network,invoice.fee];
  if(version>=2){const fee=invoice.feeBreakdown;parts.push(fee.networkFee,fee.providerCost,fee.protocolFee,fee.burn,fee.treasury,fee.merchantNet,fee.sponsorCost,fee.userRebate,fee.source,fee.asOf,fee.version);}
  if(version>=3)parts.push(invoice.baseAmount,invoice.tipAmount);
  parts.push(invoice.expiresAt,invoice.createdAt,invoice.signatureKeyId,invoice.signingPublicKey,invoice.signatureAlgorithm);
  if(version===4)parts.push(invoice.splitPaymentId,invoice.splitShareId,invoice.expectedPayerHash);
  if(version===5)parts.push(invoice.serviceBillId,invoice.serviceEvidenceDigest,invoice.expectedPayerHash);
  invoice.signature=bytesToHex(ed25519.sign(new TextEncoder().encode(parts.join("|")),merchantSeed));
  const intent={version:"1" as const,intentType:"pay.ynxt.transfer" as const,requestId:"r".repeat(32),chainId:"ynx_6423-1" as const,productClientId:"ynx-pay-v1" as const,bundleId:"com.ynxweb4.pay" as const,sessionBinding:"b".repeat(64),invoiceId:invoice.id,centralInvoiceId:invoice.centralInvoiceId,merchantId:invoice.merchantId,merchantName:invoice.merchantName,payoutAddress:invoice.payoutAddress,amount:25,asset:"YNXT" as const,fee:1 as const,total:26,quoteIssuedAt:"2026-10-03T01:00:00.000Z",quoteExpiresAt:"2026-10-03T01:01:00.000Z",invoiceSignature:invoice.signature,callback:"ynxpay://payment-result" as const};
  const session:any={version:"2",sessionBinding:intent.sessionBinding,chainId:intent.chainId,productId:"pay",clientId:intent.productClientId,platform:"ios",applicationId:intent.bundleId,bundleId:intent.bundleId,packageId:null,origin:"https://pay.ynxweb4.com",callback:"ynxpay://wallet-auth/callback",account:identity.account,deviceId:"controlled-device",deviceAlgorithm:"p256-sha256",deviceKey:Buffer.from(p256.getPublicKey(new Uint8Array(32).fill(3))).toString("base64url"),deviceBinding:"",nonce:"n".repeat(32),state:"s".repeat(32),scopes:["account:read","pay:case:create","pay:settlement:submit"],requestDigest:"c".repeat(64),approvalDigest:"d".repeat(64),issuedAt:"2026-10-03T00:59:59.000Z",expiresAt:"2026-10-03T01:02:59.000Z"};
  function parsedSession(changes:Record<string,any>={}){
    const value={...session,...changes},fields=["chainId","productId","clientId","platform","applicationId","bundleId","packageId","origin","callback","account","deviceId","deviceAlgorithm","deviceKey"];
    value.deviceBinding=digestHex("YNX_PRODUCT_SESSION_DEVICE_V2",Object.fromEntries(fields.map(key=>[key,value[key]])));
    return parseProductSession(value);
  }
  const operations=new WalletOperationLifecycle(()=>now);operations.setAccount(identity.account);
  const unlock=operations.scope().begin({requireUnlocked:false});operations.unlock(unlock);unlock.finish();const lease=operations.scope().begin();
  const authority={session:parsedSession(),assertCurrent:()=>{if(!valid)throw Error("authority revoked")},refresh:async()=>{refreshes++;return authority.session}};
  const client={account:async()=>({address:evmAddressFromYNX(identity.account),balance:26,nonce:1}),requireDurabilityCapability:async()=>{}};
  const repository={accountSecret:async(_account:string,guard:()=>void)=>{reads++;guard();return seed}};
  const input={rawInvoice:invoice,rawIntent:intent,reviewedIntentDigest:payPaymentIntentDigest(intent),review:{account:identity.account,accountPublicKey:identity.accountPublicKey,to:invoice.payoutAddress,amount:invoice.amount},policy,authority,lease,client,repository,authorize:async()=>{prompts++},now:()=>now};
  return{input,authority,operations,lease,client,repository,parsedSession,setNow:(value:number)=>{now=value},revoke:()=>{valid=false},counts:()=>({prompts,reads,refreshes})};
}
