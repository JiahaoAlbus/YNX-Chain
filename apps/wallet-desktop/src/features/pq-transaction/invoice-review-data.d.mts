/** Main-only projection DATA. No value here constitutes a user approval. */
export const PQ_INVOICE_ACTION_KINDS:readonly ['invoice_terms','invoice_settle','invoice_refund'];
export type PQInvoiceKind=typeof PQ_INVOICE_ACTION_KINDS[number];
export type PQInvoiceUnits=Readonly<{atoms:string;assetID:'YNXT';unitVersion:'1';notation:'raw-atoms'}>;
export type PQInvoiceTerms=Readonly<{invoiceID:string;sessionID:string;recipient:string;payer:string;assetID:'YNXT';unitVersion:'1';feeRule:'native-transfer-fee-one/v1';keyEpoch:string;revision:string;amount:string;maxFee:string;expiresAt:string}>;
export type PQInvoiceReviewData=Readonly<{
 version:'YNX-WALLET-INVOICE-REVIEW-DATA/v1';kind:PQInvoiceKind;title:string;
 networkId:string;nativeChainId:string;owner:string;nonce:string;merchant:string;payer:string|null;
 payerRule:'independently-approved-payer'|'original-settlement-payer'|'exact-payer';
 recipient:string;refundRecipientEditable:false;invoiceID:string;termsHash:string;terms:PQInvoiceTerms;
 actionPayload:Readonly<Record<string,string>>;amount:PQInvoiceUnits;fee:PQInvoiceUnits;principalMoves:boolean;
 refundID:string|null;settlementNativeHash:string|null;expiryRule:'execution-height-inclusive';
 purpose:'TX-BATCH';memberCount:1;memberIndex:0;currentLedgerChecksRequired:true;permissionGranted:false;
 dataOnly:true;nativeAdmission:false;submitted:false;consensusFinality:false;warning:string;
}>;
/** Structural projection only; the normal caller supplies SDK-decoded actions
 * and, for refunds, an independently inspected original settlement Member. */
export function projectPQInvoiceReviewData(action:unknown,references:unknown):PQInvoiceReviewData;
