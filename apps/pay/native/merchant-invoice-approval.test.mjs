import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPrivateNativeInvoiceClient,createNativeInvoiceMerchantApproval} from './merchant-invoice-approval.mjs';

// Loopback HTTP transport fixtures only. They are not qualified LINK/Source,
// actual Main approval, Native signatures, or a chain receipt.
const intent='npi_'+'1'.repeat(48);
const transportFor=origin=>async({method,path,body,contentType})=>new Promise((resolve,reject)=>{
 const req=http.request(origin+path,{method,headers:contentType?{'Content-Type':contentType}:{}},response=>{
  const chunks=[];response.on('data',b=>chunks.push(b));response.on('end',()=>resolve({method,requestPath:path,status:response.statusCode,contentType:response.headers['content-type'],body:Buffer.concat(chunks)}));
 });req.on('error',reject);req.end(body);
});
test('normal private client keeps exact intent/member routes and rejects redirect/mismatched originals',async t=>{
 let mode='normal';const calls=[];
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const b of req)body+=b;calls.push([req.method,req.url,body]);
  res.setHeader('Content-Type','application/json');
  if(mode==='redirect'){res.statusCode=307;res.setHeader('Location','https://unapproved.example/collect');res.end('{}');return;}
  if(req.url.endsWith('/merchant-review')){res.end(JSON.stringify({message:'',intent:{intentId:intent}}));return;}
  res.end(JSON.stringify({intentId:mode==='wrong'?'npi_'+'2'.repeat(48):intent}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const origin=`http://127.0.0.1:${server.address().port}`,client=createPrivateNativeInvoiceClient({origin,requestPrivate:transportFor(origin)});
 assert.equal((await client.readInvoiceIntent(intent)).intentId,intent);
 await client.merchantTermsReview(intent);await client.submitMerchantMember(intent,Uint8Array.of(1,2));
 assert.deepEqual(calls.map(row=>row.slice(0,2)),[['GET',`/v5/pay/invoice-intents/${intent}`],['POST',`/v5/pay/invoice-intents/${intent}/merchant-review`],['POST',`/v5/pay/invoice-intents/${intent}/merchant-member`]]);
 assert.equal(calls[1][2],'{}');assert.deepEqual(JSON.parse(calls[2][2]),{member:'AQI='});
 mode='redirect';await assert.rejects(client.readInvoiceIntent(intent),{code:'NATIVE_INVOICE_PRIVATE_RESPONSE_UNAVAILABLE'});assert.equal(calls.length,4);
 mode='wrong';await assert.rejects(client.readInvoiceIntent(intent),{code:'NATIVE_INVOICE_ORIGINAL_BINDING'});
 await assert.rejects(client.readInvoiceIntent(intent+'/other'),{code:'NATIVE_INVOICE_ORIGINAL_ID_REQUIRED'});assert.equal(calls.length,5);
});
test('no default transport and no request-controlled origin',()=>{
 for(const origin of ['http://public.example','https://pay.example/path','https://user:pass@pay.example'])assert.throws(()=>createPrivateNativeInvoiceClient({origin,requestPrivate(){}}));
 assert.throws(()=>createPrivateNativeInvoiceClient({origin:'https://pay.example'}),{code:'NATIVE_INVOICE_PRIVATE_TRANSPORT_UNAVAILABLE'});
});
test('missing protected Main or changed signing bytes cannot enter any signing review',async()=>{
 assert.throws(()=>createNativeInvoiceMerchantApproval({main:{},pay:{}}),{code:'NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE'});
 let entries=0;
 const main={requestPQTypedAction(){entries++},reject(){},transactionSender:{submissions:{intentStore:{readPQOriginals(){return []},unresolvedPreparation(){return false}}}}};
 const pay={async readInvoiceIntent(){return {}},async merchantTermsReview(){return {message:'AQ==',intent:{signingMessageHash:'0'.repeat(64)}}}};
 const adapter=createNativeInvoiceMerchantApproval({main,pay});await assert.rejects(adapter.requestMerchantTerms(intent,()=>{}),{code:'NATIVE_INVOICE_REVIEW_BINDING'});assert.equal(entries,0);
});
