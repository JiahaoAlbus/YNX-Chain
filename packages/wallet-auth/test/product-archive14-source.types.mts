import {inspectOriginalWalletProductArchiveReadV1DATA as route,WALLET_NATIVE_PRODUCT_ARCHIVE_READ_OPERATIONS}from'../native/original-wallet-product-source-contract.mjs';
import type{WalletProductSourceScopeV1,WalletProductArchiveReceiptReferenceV1,WalletProductArchiveReconciliationReferenceV1}from'../native/original-wallet-product-source-contract.mjs';
import type{OriginalProductSourcePay,OriginalProductSourceCurrentFence,OriginalNativePayArchiveReceiptData,OriginalNativePayArchiveReconciliationData}from'../src/pq-native-pay-source.js';
declare const scope:WalletProductSourceScopeV1,receipt:WalletProductArchiveReceiptReferenceV1,recon:WalletProductArchiveReconciliationReferenceV1,pay:OriginalProductSourcePay,current:OriginalProductSourceCurrentFence;
const r=route(scope,'readOriginalArchiveReceipt',receipt,'network','owner',0,100,1),q=route(scope,'readOriginalArchiveReconciliation',recon,'network','owner',0,100,1);
const get:'GET'=r.method,body:null=r.body,noGrant:false=q.authorized;
if(pay.readOriginalArchiveReceipt){const out:OriginalNativePayArchiveReceiptData|Promise<OriginalNativePayArchiveReceiptData>=pay.readOriginalArchiveReceipt(receipt,current);void out;}
if(pay.readOriginalArchiveReconciliation){const out:OriginalNativePayArchiveReconciliationData|Promise<OriginalNativePayArchiveReconciliationData>=pay.readOriginalArchiveReconciliation(recon,current);void out;}
// @ts-expect-error receipt route requires original nativeHash.
route(scope,'readOriginalArchiveReceipt',recon,'n','o',0,1,0);
// @ts-expect-error reconciliation cannot carry receipt hash, even as a typed variable.
route(scope,'readOriginalArchiveReconciliation',receipt,'n','o',0,1,0);
// @ts-expect-error archive helper cannot turn createInvoiceIntent into GET.
route(scope,'createInvoiceIntent',receipt,'n','o',0,1,0);
// @ts-expect-error comparison DATA is never an admitted Native Source.
const root:{authorized:true}=r;
// @ts-expect-error original readonly reference cannot be silently updated for retry.
receipt.nativeHash='new';
void[get,body,noGrant,root,WALLET_NATIVE_PRODUCT_ARCHIVE_READ_OPERATIONS];
