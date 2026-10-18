import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ambiguousWalletInvoiceReference} from './walletQRReferencePolicy';
import {parseWalletScan} from './walletScan';
const require=createRequire(new URL('../../../wallet-desktop/package.json',import.meta.url));
const desktop=require('./src/wallet-qr-reference-policy.mjs') as {ambiguousWalletInvoiceReference:(value:string)=>boolean};
// Shape-only PUBLIC strings, never imported/derived keys or live accounts.
const ambiguous=[
 'ab'.repeat(32),'AB'.repeat(32),'0x'+'12'.repeat(32),'cd'.repeat(64),
 ...['xprv','tprv','yprv','zprv','Yprv','Zprv','uprv','vprv','Uprv','Vprv'].map(p=>p+'2'.repeat(107)),
 '5'+'2'.repeat(50),...['K','L','c'].map(p=>p+'2'.repeat(51)),'9'+'2'.repeat(50),
 'ynx1'+'q'.repeat(38),'0x'+'12'.repeat(20),
 ...['bc1','tb1','bcrt1'].map(p=>p+'q'.repeat(39)),'T'+'1'.repeat(33),...['1','3','m','n','2'].map(p=>p+'A'.repeat(25)),
];
test('Android/Web and desktop routing reject the same bare wallet-material shapes',()=>{
 for(const value of ambiguous){assert.equal(ambiguousWalletInvoiceReference(value),true);assert.equal(desktop.ambiguousWalletInvoiceReference(value),true);assert.throws(()=>parseWalletScan(value),e=>{assert.doesNotMatch(String((e as Error).message),new RegExp(value));return true;});}
});
test('ordinary legacy invoice IDs and explicit original invoice links remain compatible on both classifiers',()=>{
 for(const id of ['invoice-original-001','inv_'+'ab'.repeat(10),'abc123']){
  assert.equal(ambiguousWalletInvoiceReference(id),false);assert.equal(desktop.ambiguousWalletInvoiceReference(id),false);assert.deepEqual(parseWalletScan(id),{kind:'invoice',invoiceID:id});
 }
 // An otherwise ambiguous ID remains representable in the explicit Pay
 // namespace; this does not derive keys, query a server or authorize payment.
 for(const id of ['ab'.repeat(32),'invoice-original-001'])for(const value of ['ynxpay://invoice/'+id,'https://pay.ynxweb4.com/invoices/'+id]){
  assert.equal(ambiguousWalletInvoiceReference(value),false);assert.equal(desktop.ambiguousWalletInvoiceReference(value),false);assert.deepEqual(parseWalletScan(value),{kind:'invoice',invoiceID:id});
 }
});
