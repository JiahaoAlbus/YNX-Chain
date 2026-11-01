import{encodePQNativeAction,decodePQNativeAction,encodePQNativeActionPayload,decodePQNativeActionPayload}from'../src/pq-native-action.js';
import type{PQNativeActionInput,PQNativeActionPayloadMap,PQNativeAction}from'../src/pq-native-action.js';
const terms:PQNativeActionPayloadMap['invoice_terms']={invoiceID:'invoice-001',sessionID:'session:001',recipient:'0x'+'1'.repeat(40),payer:'',assetID:'YNXT',unitVersion:'1',feeRule:'native-transfer-fee-one/v1',keyEpoch:'1',revision:1n,amount:'1',maxFee:'1',expiresAt:'9'};
const action:PQNativeActionInput<'invoice_terms'>={chainId:'ab'.repeat(32),nativeChainId:'1',owner:'0x'+'1'.repeat(40),nonce:'1',fee:'1',kind:'invoice_terms',payload:terms};
const bytes:Uint8Array=encodePQNativeAction(action);const result:PQNativeAction=decodePQNativeAction(bytes);decodePQNativeActionPayload('invoice_terms',encodePQNativeActionPayload('invoice_terms',terms));
encodePQNativeActionPayload('invoice_settle',{merchant:action.owner,invoiceID:'invoice-001',termsHashHex:'ab'.repeat(32),amount:'1'});
encodePQNativeActionPayload('invoice_refund',{invoiceID:'invoice-001',refundID:'refund-001',termsHashHex:'ab'.repeat(32),settlementHashHex:'cd'.repeat(32),amount:'1'});
// @ts-expect-error Ledger numeric inputs reject lossy JavaScript numbers.
encodePQNativeActionPayload('invoice_terms',{...terms,amount:1});
// @ts-expect-error Invoice ledger unit is1, not EVM18.
encodePQNativeActionPayload('invoice_terms',{...terms,unitVersion:'18'});
// @ts-expect-error Refund receiver is derived by the ledger, never an input.
encodePQNativeActionPayload('invoice_refund',{invoiceID:'invoice-001',refundID:'refund-001',termsHashHex:'ab'.repeat(32),settlementHashHex:'cd'.repeat(32),amount:'1',recipient:action.owner});
// @ts-expect-error No signature/permission is created by parsing DATA.
const authorized:boolean=result.authorized;
void authorized;
import{planPQNativeAction}from'../src/pq-wallet-policy.js';
import type{PQAuthorizationSnapshot}from'../src/pq-wallet-policy.js';
declare const selectedSnapshot:PQAuthorizationSnapshot;
const planned=planPQNativeAction(selectedSnapshot,action);
const invoiceKind:'invoice_terms'=planned.action.kind;
void invoiceKind;
