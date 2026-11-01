import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createPrivateNativeProductPayClient} from '../r6/merchant-invoice-approval.mjs';
const projector=process.argv[2];if(!path.isAbsolute(projector??''))throw Error('Exact compiled original Auth DATA projector required');
const merchant='0x'+'a'.repeat(40),nativeHash='0x'+'b'.repeat(64),calls=[];
const client=createPrivateNativeProductPayClient({origin:'https://public-contract.invalid',requestPrivate:async request=>{
 request.assertCurrent();assert.equal(request.method,'GET');assert.equal(request.body,undefined);calls.push(request.path);
 return{method:'GET',requestPath:request.path,status:200,contentType:'application/json',body:Buffer.from('{}')};
}});
assert.equal(Object.keys(client).length,13);
for(const name of ['submitMerchantMemberPacket','submitSettlementPacket','submitRefundPacket','submitMerchantMember','submitSettlement','submitRefund','readInvoicePacket','readInvoiceIntentPacket'])assert.equal(client[name],undefined);
for(const productId of ['shop.order','cloud.ide-usage'])for(const operation of ['readOriginalArchiveReceipt','readOriginalArchiveReconciliation']){
 const ref={productId,sourceOrder:'order:original_001',merchant,invoiceId:'invoice:original_001',...(operation==='readOriginalArchiveReceipt'?{nativeHash}:{})};
 const expected=execFileSync(projector,[operation,productId,ref.sourceOrder,merchant,ref.invoiceId,...(ref.nativeHash?[ref.nativeHash]:[])],{encoding:'utf8'}).trim();
 await client[operation](ref,()=>{});assert.equal(calls.at(-1),expected);assert.match(expected,/%3A/);assert.ok(!expected.includes('?'));
}
const before=calls.length;
for(const ref of [
 {productId:'wallet.member5',sourceOrder:'order:001',merchant,invoiceId:'invoice:001',nativeHash},
 {productId:'shop.order',sourceOrder:'../order',merchant,invoiceId:'invoice:001',nativeHash},
 {productId:'shop.order',sourceOrder:'order:001',merchant:merchant.toUpperCase(),invoiceId:'invoice:001',nativeHash},
 {productId:'shop.order',sourceOrder:'order:001',merchant,invoiceId:'invoice:001',nativeHash,nonce:'1'},
])assert.throws(()=>client.readOriginalArchiveReceipt(ref,()=>{}),{code:'NATIVE_PAY_PRODUCT_REFERENCE_INVALID'});
assert.equal(calls.length,before);
process.stdout.write(JSON.stringify({result:'PASS',originalProductPayFacade13:true,noMemberPacketOrSubmitSurface:true,originalAuthCppProjectorMatched:4,colonSegmentsEncoded:true,invalidRefNoTransport:4,GET:4,POST:0,RootAdmission:false,SourceAdmission:false})+'\n');
