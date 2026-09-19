import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {
  createFinanceOrderApprovalRequest,
  createFinanceOrderApprovalReturnURL,
  createSignedFinanceOrderApproval,
  createSignedFinanceOrderApprovalRevocation,
} from '../web/node_modules/@ynx-chain/wallet-auth-finance-order/src/index.js';
import registry from '../web/vendor/product-session-registry-a7dad7ec.json' with {type:'json'};

const ORIGIN='https://finance.ynxweb4.com';
const vectors=JSON.parse(await readFile(new URL('../integration/wallet-auth/finance-order-approval-v1.vectors.json',import.meta.url),'utf8'));
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});});
test.after(async()=>browser.close());

async function setup(){
  const context=await browser.newContext();
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    assert.equal(url.origin,ORIGIN,'order Wallet fixture may not use the network');
    if(url.pathname==='/order-wallet.js')return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../web/order-wallet.js',import.meta.url))});
    return route.fulfill({contentType:'text/html',body:'<!doctype html><script src="/order-wallet.js"></script>'});
  });
  const page=await context.newPage();await page.goto(ORIGIN);await page.waitForFunction(()=>!!window.YNXFinanceOrderWallet);
  return {context,page};
}

test('real browser bundle converts canonical server wire time to Date and persists the exact request',async()=>{
  const fixture=await setup();
  try{
    const result=await fixture.page.evaluate(({unsigned,serverTime})=>window.YNXFinanceOrderWallet.begin(unsigned,serverTime),{unsigned:vectors.positive.unsigned,serverTime:'2026-09-19T09:00:00.000Z'});
    assert.match(result.url,/^ynxwallet:\/\/finance-order-approval\?request=/);
    assert.deepEqual(await fixture.page.evaluate(()=>window.YNXFinanceOrderWallet.pending()),{approvedProof:null,request:result.request,version:'1'});
  }finally{await fixture.context.close();}
});

test('approved proof survives delivery failure and reload so an exact revocation can be verified',async()=>{
  const fixture=await setup();
  try{
    const at=new Date('2026-09-19T09:00:01.000Z');
    const request=createFinanceOrderApprovalRequest(vectors.positive.unsigned,at);
    const approval=createSignedFinanceOrderApproval({accountSecret:vectors.positive.testOnlyPublicSecretScalarHex,approval:vectors.positive.unsigned},at);
    const approvedURL=createFinanceOrderApprovalReturnURL(registry,request,{status:'approved',approval},at);
    await fixture.page.evaluate(({unsigned})=>window.YNXFinanceOrderWallet.begin(unsigned,'2026-09-19T09:00:01.000Z'),{unsigned:vectors.positive.unsigned});
    const approved=JSON.parse(await fixture.page.evaluate(url=>window.YNXFinanceOrderWallet.parseReturn(url,'2026-09-19T09:00:01.000Z'),approvedURL));
    assert.equal(approved.status,'approved');
    assert.deepEqual((await fixture.page.evaluate(()=>window.YNXFinanceOrderWallet.pending())).approvedProof,approval);
    await fixture.page.reload();await fixture.page.waitForFunction(()=>!!window.YNXFinanceOrderWallet);
    const revokedAt=new Date('2026-09-19T09:00:02.000Z');
    const revocation=createSignedFinanceOrderApprovalRevocation({accountSecret:vectors.positive.testOnlyPublicSecretScalarHex,approval},revokedAt);
    const revokedURL=createFinanceOrderApprovalReturnURL(registry,request,{status:'revoked',approval,revocation},revokedAt);
    const revoked=JSON.parse(await fixture.page.evaluate(url=>window.YNXFinanceOrderWallet.parseReturn(url,'2026-09-19T09:00:02.000Z'),revokedURL));
    assert.equal(revoked.status,'revoked');
    assert.deepEqual((await fixture.page.evaluate(()=>window.YNXFinanceOrderWallet.pending())).approvedProof,approval);
  }finally{await fixture.context.close();}
});

test('real browser bundle rejects invalid or missing authority time without device-clock fallback or pending state',async()=>{
  const fixture=await setup();
  try{
    for(const serverTime of [undefined,'2026-09-19T09:00:00Z','not-a-time','2026-02-30T09:00:00.000Z']){
      const result=await fixture.page.evaluate(({unsigned,serverTime})=>{try{window.YNXFinanceOrderWallet.begin(unsigned,serverTime);return 'accepted'}catch(error){return error.message}},{unsigned:vectors.positive.unsigned,serverTime});
      assert.equal(result,'FINANCE_ORDER_AUTHORITY_TIME_INVALID');
      assert.equal(await fixture.page.evaluate(()=>window.YNXFinanceOrderWallet.pending()),null);
    }
  }finally{await fixture.context.close();}
});
