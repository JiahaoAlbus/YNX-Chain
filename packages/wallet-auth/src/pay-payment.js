import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalJSON, exactFields, WalletAuthError } from './canonical.js';
import { walletIdentity, walletIdentityFromPublicKey, evmAddressFromYNX } from './crypto.js';
import { parseSignedNativeTransfer, nativeTransferHash } from './native-transfer.js';

const INTENT_FIELDS=['version','intentType','requestId','chainId','productClientId','bundleId','sessionBinding','invoiceId','centralInvoiceId','merchantId','merchantName','payoutAddress','amount','asset','fee','total','quoteIssuedAt','quoteExpiresAt','invoiceSignature','callback'];
const RESULT_FIELDS=['version','intentDigest','requestId','invoiceId','chainId','account','accountPublicKey','transactionHash','issuedAt','walletSignature'];
export const PAY_PAYMENT_INTENT_DOMAIN='YNX_PAY_SIGNED_INTENT_V1';
export const PAY_PAYMENT_RESULT_DOMAIN='YNX_PAY_WALLET_RESULT_V1';
const fail=(code,message)=>{throw new WalletAuthError(code,message);};
function text(value,pattern,label){if(typeof value!=='string'||!pattern.test(value))fail('INVALID_PAY_INTENT',label);return value;}
function time(value){text(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,'Invalid payment time');const t=Date.parse(value);if(!Number.isFinite(t)||new Date(t).toISOString()!==value)fail('INVALID_PAY_INTENT','Invalid payment time');return t;}
function positive(value){if(!Number.isSafeInteger(value)||value<=0)fail('INVALID_PAY_INTENT','Payment amount must be a positive whole native unit');return value;}
function instant(now){if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail('INVALID_PAY_TIME','Invalid current time');return now.getTime();}
export function parsePayPaymentIntent(value,now=new Date()){
 exactFields(value,INTENT_FIELDS,'Pay payment intent');
 if(value.version!=='1'||value.intentType!=='pay.ynxt.transfer'||value.chainId!=='ynx_6423-1'||value.productClientId!=='ynx-pay-v1'||value.bundleId!=='com.ynxweb4.pay'||value.asset!=='YNXT'||value.fee!==1||value.callback!=='ynxpay://payment-result')fail('INVALID_PAY_INTENT','Payment protocol binding is invalid');
 text(value.requestId,/^[A-Za-z0-9_-]{32,64}$/,'Invalid request ID');text(value.sessionBinding,/^[a-f0-9]{64}$/,'Invalid session binding');text(value.invoiceId,/^inv_[a-f0-9]{20}$/,'Invalid invoice ID');
 for(const key of ['centralInvoiceId','merchantId'])text(value[key],/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,'Invalid invoice authority identifier');
 if(typeof value.merchantName!=='string'||value.merchantName.length<1||value.merchantName.length>256||/[\x00-\x1f\x7f]/.test(value.merchantName))fail('INVALID_PAY_INTENT','Invalid merchant name');
 evmAddressFromYNX(value.payoutAddress);positive(value.amount);positive(value.total);if(!Number.isSafeInteger(value.amount+1)||value.total!==value.amount+1)fail('INVALID_PAY_INTENT','Payment total does not reconcile');text(value.invoiceSignature,/^[a-f0-9]{128}$/,'Invalid invoice signature');
 const issued=time(value.quoteIssuedAt),expires=time(value.quoteExpiresAt),current=instant(now);if(expires<=issued||expires-issued>300000||issued>current+30000||expires<=current)fail('PAY_QUOTE_EXPIRED','Payment quote is not active');
 return Object.freeze({...value});
}
export function payPaymentIntentDigest(intent){exactFields(intent,INTENT_FIELDS,'Pay payment intent');return bytesToHex(sha256(utf8ToBytes(`${PAY_PAYMENT_INTENT_DOMAIN}\n${canonicalJSON(intent)}`)));}

// A cryptographic result binds an already signed native transfer. It is not
// merchant trust, user consent, broadcast confirmation, or a settlement receipt.
// The Wallet controller must verify its pinned invoice and acquire the existing
// guarded key-access lease after explicit review before invoking this primitive.
export function createSignedPayPaymentResult(input,now=new Date()){
 exactFields(input,['accountSecret','intent','transferPayload','issuedAt'],'Pay payment-result signing input');
 const intent=parsePayPaymentIntent(input.intent,now),identity=walletIdentity(input.accountSecret),transfer=parseSignedNativeTransfer(input.transferPayload);
 if(transfer.from!==evmAddressFromYNX(identity.account)||transfer.publicKey!==identity.accountPublicKey||transfer.to!==evmAddressFromYNX(intent.payoutAddress)||transfer.amount!==intent.amount||transfer.fee!==intent.fee)fail('PAY_TRANSFER_MISMATCH','Native transfer does not match the reviewed invoice and signing account');
 const at=time(input.issuedAt);if(at<time(intent.quoteIssuedAt)||at>time(intent.quoteExpiresAt)||at>instant(now)+30000)fail('PAY_QUOTE_EXPIRED','Payment result is outside the quote lifetime');
 const unsigned={version:'1',intentDigest:payPaymentIntentDigest(intent),requestId:intent.requestId,invoiceId:intent.invoiceId,chainId:'ynx_6423-1',account:identity.account,accountPublicKey:identity.accountPublicKey,transactionHash:nativeTransferHash(input.transferPayload),issuedAt:input.issuedAt};
 const walletSignature=bytesToHex(secp256k1.sign(sha256(utf8ToBytes(`${PAY_PAYMENT_RESULT_DOMAIN}\n${canonicalJSON(unsigned)}`)),hexToBytes(input.accountSecret),{prehash:false,format:'compact',lowS:true}));
 return Object.freeze({...unsigned,walletSignature});
}
export function verifyPayPaymentResult(value,intent,account,now=new Date()){
 const parsed=parsePayPaymentIntent(intent,now);exactFields(value,RESULT_FIELDS,'Pay payment result');
 if(value.version!=='1'||value.intentDigest!==payPaymentIntentDigest(parsed)||value.requestId!==parsed.requestId||value.invoiceId!==parsed.invoiceId||value.chainId!=='ynx_6423-1'||value.account!==account)fail('PAY_RESULT_BINDING_MISMATCH','Payment result binding is invalid');
 text(value.accountPublicKey,/^(02|03)[a-f0-9]{64}$/,'Invalid signing public key');text(value.transactionHash,/^0x[a-f0-9]{64}$/,'Invalid native transaction hash');text(value.walletSignature,/^[a-f0-9]{128}$/,'Invalid result signature');
 const at=time(value.issuedAt);if(at<time(parsed.quoteIssuedAt)||at>time(parsed.quoteExpiresAt)||at>instant(now)+30000)fail('PAY_QUOTE_EXPIRED','Payment result is outside quote lifetime');
 const {walletSignature,...unsigned}=value;
 let valid=false;try{valid=walletIdentityFromPublicKey(value.accountPublicKey)===account&&secp256k1.verify(hexToBytes(walletSignature),sha256(utf8ToBytes(`${PAY_PAYMENT_RESULT_DOMAIN}\n${canonicalJSON(unsigned)}`)),hexToBytes(value.accountPublicKey),{prehash:false,format:'compact',lowS:true});}catch{}
 if(!valid)fail('INVALID_PAY_RESULT_SIGNATURE','Invalid payment result signature');return Object.freeze({...value});
}
