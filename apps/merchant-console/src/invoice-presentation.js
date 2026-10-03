import {realRecords} from './api.js';
// Presentation consumes only current, selected Merchant records. It creates no
// authority, payment URI, signature, settlement, or client-side chain rounding.
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
const reject=()=>Object.assign(new Error('The selected invoice is unavailable. Refresh your merchant records.'),{code:'MERCHANT_INVOICE_UNAVAILABLE'});
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
