import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
test('versioned r6 candidate reopens the original invoice and blocks uncertain direct review',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pay-candidate-entry-'));
 try{
  const root=path.join(temp,'bridge');fs.mkdirSync(root);const module=`import {createNativePayMainEntry} from '../main-entry.mjs';
const account='0x'+'1'.repeat(40);const main={requestPQTypedAction(){throw Error('unexpected review')},reject(){},transactionSender:{submissions:{intentStore:{readPQOriginals(){},unresolvedPreparation(){}}}}};
const pay={merchantTermsReview(){},readInvoiceIntent(){},async readInvoice(merchant,invoiceId){if(merchant!==account||invoiceId!=='invoice-original')throw Error('wrong original');return {merchant,invoiceId,status:'committed_paid',refundStatus:'unknown',paidAtoms:'100',refundedAtoms:'30',netPaidAtoms:'70'}},reviewSettlement(){throw Error('review reached')},reviewRefund(){throw Error('review reached')}};
export async function openNativePayMainEntry(){const e=createNativePayMainEntry({getMain:()=>main,getContext:()=>({account,revision:1,focused:true})});e.compose({pay,current(){}});return e}`;
  fs.writeFileSync(path.join(root,'entry.mjs'),module);fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({entry:'entry.mjs',files:[{path:'entry.mjs',sha256:createHash('sha256').update(module).digest('hex')}]}));
  const output=path.join(temp,'candidate'),build=spawnSync(process.execPath,[path.join(here,'../scripts/build-qa.mjs'),'--r6','--main-runtime-manifest',path.join(root,'manifest.json'),output],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
  const invoke=request=>{const p=spawnSync(path.join(output,'bin/node'),[path.join(output,'lib/desktop-entry.mjs')],{input:JSON.stringify(request),encoding:'utf8'});return JSON.parse(p.stdout)};
  const merchant='0x'+'1'.repeat(40),invoiceId='invoice-original';const read=invoke({action:'invoice',merchant,invoiceId});assert.equal(read.outcomeUnknown,true);assert.equal(read.bill.refundedAtoms,'30');assert.equal(read.bill.netPaidAtoms,'70');assert.deepEqual(read.recoveryActions,[{action:'invoice',merchant,invoiceId}]);
  const reopened=invoke(read.recoveryActions[0]);assert.equal(reopened.outcomeUnknown,true);for(const request of [{action:'pay-review',merchant,invoiceId},{action:'refund-review',merchant,invoiceId,refundId:'refund-original',amountAtoms:'30'}]){const result=invoke(request);assert.equal(result.code,'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED');assert.equal(result.canRetry,false)}
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
