import {realRecords} from './api.js';
// Presentation consumes only current, selected Merchant records. It creates no
// authority, payment URI, signature, settlement, or client-side chain rounding.
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
const reject=()=>Object.assign(new Error('The selected invoice is unavailable. Refresh your merchant records.'),{code:'MERCHANT_INVOICE_UNAVAILABLE'});
export function merchantRefundRecoveryLabel(kind,status){
 if(kind!=='refund')return null;
 if(status==='submitted')return 'Check chain evidence';
 if(status==='unknown')return 'Check original status';
 return null;
}
export function merchantRefundRecoveryNotice(result,originalId){
 if(!result||result.id!==originalId)throw Object.assign(new Error('Original refund result changed. Refresh the same merchant record.'),{code:'MERCHANT_REFUND_ORIGINAL_CHANGED'});
 if(result.status==='unknown')return 'The original refund outcome is still unknown. No new refund was submitted.';
 if(result.status==='submitted')return 'The original refund is submitted. Check chain evidence before treating it as refunded.';
 if(result.status==='refunded'){
  const evidence=result.evidence;
  if(!evidence||evidence.requestId!==originalId||typeof result.centralRefundId!=='string'||!result.centralRefundId||evidence.id!==result.centralRefundId||typeof result.payer!=='string'||!result.payer||evidence.payer!==result.payer||!integer(result.amount,1)||evidence.amount!==result.amount||typeof result.approvedBy!=='string'||!result.approvedBy||evidence.merchantAccount!==result.approvedBy||evidence.asset!=='YNXT'||evidence.transactionHash!==result.refundTransactionHash||evidence.status!=='refunded'||evidence.finality!=='committed'||evidence.confidence!=='authoritative'||evidence.source!=='authoritative-central-pay-api'||!Number.isSafeInteger(evidence.blockNumber)||evidence.blockNumber<=0||!/^0x[0-9a-f]{64}$/.test(evidence.transactionHash??'')||typeof evidence.receiptId!=='string'||!evidence.receiptId)throw Object.assign(new Error('Original refund evidence is unavailable. Refresh the same merchant record.'),{code:'MERCHANT_REFUND_ORIGINAL_CHANGED'});
  return 'The original refund has authoritative evidence. Review the updated record.';
 }
 throw Object.assign(new Error('Original refund status is unavailable. Refresh the same merchant record.'),{code:'MERCHANT_REFUND_ORIGINAL_CHANGED'});
}
export function merchantRefundEvidence(result){
 if(result?.status!=='refunded'||typeof result.id!=='string')return null;
 try{merchantRefundRecoveryNotice(result,result.id);return result.evidence;}catch{return null;}
}
export function merchantInvoicePresentation(invoice,merchantId){
 if(!invoice||invoice.merchantId!==merchantId||typeof invoice.id!=='string'||!invoice.id||typeof invoice.centralInvoiceId!=='string'||!invoice.centralInvoiceId||!integer(invoice.amount,1)||!integer(invoice.fee)||invoice.asset!=='YNXT'||invoice.network!=='ynx_6423-1'||!Number.isInteger(invoice.version)||invoice.version<1||invoice.version>5||!Number.isFinite(Date.parse(invoice.expiresAt))||!Number.isFinite(Date.parse(invoice.createdAt)))throw reject();
 const tip=invoice.version>=3?invoice.tipAmount??0:0,base=invoice.version>=3?invoice.baseAmount:invoice.amount;
 if(!integer(base,1)||!integer(tip)||!integer(base+tip,1)||base+tip!==invoice.amount)throw reject();
 return Object.freeze({id:invoice.id,centralInvoiceId:invoice.centralInvoiceId,merchantId:invoice.merchantId,merchantName:String(invoice.merchantName??''),description:String(invoice.description??''),baseAmount:base,tipAmount:tip,amount:invoice.amount,fee:invoice.fee,asset:invoice.asset,network:invoice.network,status:String(invoice.status??''),expiresAt:invoice.expiresAt,createdAt:invoice.createdAt,signature:String(invoice.signature??''),signingPublicKey:String(invoice.signingPublicKey??''),signatureAlgorithm:String(invoice.signatureAlgorithm??''),settlement:invoice.settlement?JSON.parse(JSON.stringify(invoice.settlement)):null});
}
export function merchantInvoiceInput(values,catalog,merchantId,{recover=false}={}){
 const selected=String(values.catalogItemId??''),tip=Number(values.tipAmount),expiry=Number(values.expiry);
 if(recover&&selected){if(!/^[A-Za-z0-9._:-]{3,128}$/.test(selected)||!integer(tip)||!integer(expiry,1)||expiry>1440)throw reject();return {catalogItemId:selected,tipAmount:tip,expiresInMinutes:expiry};}
 let amount=Number(values.amount),description=String(values.description??''),item;
 if(selected){const matches=catalog.filter(row=>row.id===selected&&row.merchantId===merchantId&&row.active===true);if(matches.length!==1||!integer(matches[0].amount,1))throw reject();item=matches[0];amount=item.amount;description=item.name;}
 if(!integer(amount,1)||!integer(tip)||tip>amount||!integer(amount+tip,1)||!integer(expiry,1)||expiry>1440||typeof description!=='string'||description.length>240||!description.trim())throw new Error('Enter a valid whole YNXT amount, tip, description and expiry.');
 return selected?{catalogItemId:selected,tipAmount:tip,expiresInMinutes:expiry}:{description,amount,tipAmount:tip,expiresInMinutes:expiry};
}

export async function currentMerchantInvoice(api,assertCurrent,subject,id){assertCurrent();const snapshot=await api.state();assertCurrent();const records=realRecords(snapshot,subject);return merchantInvoicePresentation(records.invoices.find(row=>row.id===id),subject.merchantId);}
