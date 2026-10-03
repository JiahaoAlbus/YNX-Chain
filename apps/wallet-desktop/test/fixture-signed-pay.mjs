import {createECDH,createHash,createPrivateKey,createPublicKey,sign} from "node:crypto";
import {createPayInvoiceSignerPolicy,digestHex,parseProductSession,payPaymentIntentDigest,walletIdentity,ynxAddressFromEVM,evmAddressFromYNX} from "@ynx-chain/wallet-auth";
// Synthetic protocol fixture, not a registered authority or production adapter.
export const payTestSecret="01".repeat(32);
export function signedPayFixture(version=1,expectedPayerHash){
  const identity=walletIdentity(payTestSecret),at=Date.parse("2026-10-03T01:00:00Z");let now=at,valid=true;
  const merchant=createPrivateKey({key:Buffer.concat([Buffer.from("302e020100300506032b657004220420","hex"),Buffer.alloc(32,11)]),format:"der",type:"pkcs8"});
  const publicKey=createPublicKey(merchant).export({format:"der",type:"spki"}).subarray(-32).toString("hex");
  const invoice={version,id:"inv_"+"a".repeat(20),centralInvoiceId:"controlled-central",intentId:"controlled-intent",merchantId:"controlled-merchant",merchantName:"Controlled merchant",payoutAddress:ynxAddressFromEVM("0x"+"2".repeat(40)),amount:25,asset:"YNXT",network:"ynx_6423-1",fee:1,expiresAt:"2026-10-03T02:00:00Z",createdAt:"2026-10-03T00:00:00Z",signature:"",signatureKeyId:"controlled-key",signingPublicKey:publicKey,signatureAlgorithm:"ed25519"};
  if(version>=2)invoice.feeBreakdown={networkFee:1,providerCost:0,protocolFee:0,burn:0,treasury:0,merchantNet:25,sponsorCost:0,userRebate:0,source:"controlled-fixture",asOf:"2026-10-03T00:00:00Z",version:1};
  if(version>=3){invoice.baseAmount=20;invoice.tipAmount=5}
  if(version>=4)invoice.expectedPayerHash=expectedPayerHash??createHash("sha256").update(`YNX_PAY_EXPECTED_PAYER_V1|${identity.account}`).digest("hex");
  if(version===4){invoice.splitPaymentId="spl_"+"e".repeat(20);invoice.splitShareId="shr_"+"f".repeat(16)}
  if(version===5){invoice.serviceBillId="qbl_"+"e".repeat(20);invoice.serviceEvidenceDigest="f".repeat(64)}
  // Original53eb wire independently transcribed; never sign with verifier.
  const parts=[`YNX_PAY_INVOICE_V${version}`,version,invoice.id,invoice.centralInvoiceId,invoice.intentId,invoice.merchantId,invoice.merchantName,invoice.payoutAddress,invoice.amount,invoice.asset,invoice.network,invoice.fee];
  if(version>=2){const f=invoice.feeBreakdown;parts.push(f.networkFee,f.providerCost,f.protocolFee,f.burn,f.treasury,f.merchantNet,f.sponsorCost,f.userRebate,f.source,f.asOf,f.version)}
  if(version>=3)parts.push(invoice.baseAmount,invoice.tipAmount);
  parts.push(invoice.expiresAt,invoice.createdAt,invoice.signatureKeyId,invoice.signingPublicKey,invoice.signatureAlgorithm);
  if(version===4)parts.push(invoice.splitPaymentId,invoice.splitShareId,invoice.expectedPayerHash);
  if(version===5)parts.push(invoice.serviceBillId,invoice.serviceEvidenceDigest,invoice.expectedPayerHash);
  invoice.signature=sign(null,Buffer.from(parts.join("|")),merchant).toString("hex");
  const intent={version:"1",intentType:"pay.ynxt.transfer",requestId:"r".repeat(32),chainId:"ynx_6423-1",productClientId:"ynx-pay-v1",bundleId:"com.ynxweb4.pay",sessionBinding:"b".repeat(64),invoiceId:invoice.id,centralInvoiceId:invoice.centralInvoiceId,merchantId:invoice.merchantId,merchantName:invoice.merchantName,payoutAddress:invoice.payoutAddress,amount:25,asset:"YNXT",fee:1,total:26,quoteIssuedAt:"2026-10-03T01:00:00.000Z",quoteExpiresAt:"2026-10-03T01:01:00.000Z",invoiceSignature:invoice.signature,callback:"ynxpay://payment-result"};
  const device=createECDH("prime256v1");device.setPrivateKey(Buffer.alloc(32,3));
  const session={version:"2",sessionBinding:intent.sessionBinding,chainId:intent.chainId,productId:"pay",clientId:intent.productClientId,platform:"ios",applicationId:intent.bundleId,bundleId:intent.bundleId,packageId:null,origin:"https://pay.ynxweb4.com",callback:"ynxpay://wallet-auth/callback",account:identity.account,deviceId:"controlled-device",deviceAlgorithm:"p256-sha256",deviceKey:device.getPublicKey(undefined,"compressed").toString("base64url"),deviceBinding:"",nonce:"n".repeat(32),state:"s".repeat(32),scopes:["account:read","pay:case:create","pay:settlement:submit"],requestDigest:"c".repeat(64),approvalDigest:"d".repeat(64),issuedAt:"2026-10-03T00:59:59.000Z",expiresAt:"2026-10-03T01:02:59.000Z"};
  const parsedSession=(changes={})=>{const value={...session,...changes},fields=["chainId","productId","clientId","platform","applicationId","bundleId","packageId","origin","callback","account","deviceId","deviceAlgorithm","deviceKey"];value.deviceBinding=digestHex("YNX_PRODUCT_SESSION_DEVICE_V2",Object.fromEntries(fields.map(key=>[key,value[key]])));return parseProductSession(value)};
  const authority={session:parsedSession(),assertCurrent:()=>{if(!valid)throw Error("revoked")},refresh:async()=>authority.session,verifyInvoicePayable:async()=>{}};
  const policy=createPayInvoiceSignerPolicy({schemaVersion:"ynx-pay-invoice-signers/v1",signers:[{keyId:"controlled-key",publicKey,algorithm:"ed25519",merchantIds:["controlled-merchant"]}]});
  return {identity,authority,parsedSession,setNow:value=>{now=value},revoke:()=>{valid=false},input:{rawInvoice:invoice,rawIntent:intent,reviewedIntentDigest:payPaymentIntentDigest(intent),review:{account:identity.account,accountPublicKey:identity.accountPublicKey,to:invoice.payoutAddress,amount:25},policy,authority,now:()=>now,client:{account:async()=>({address:evmAddressFromYNX(identity.account),balance:26,nonce:1}),requireDurabilityCapability:async()=>{}}}};
}
