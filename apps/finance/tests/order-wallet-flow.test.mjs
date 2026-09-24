import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';
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
test.before(async()=>{browser=await chromium.launch(await financeBrowserLaunchOptions());});
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

test('real browser bundle fails closed before creating order pending state while v2 authority is unconfigured',async()=>{
  const fixture=await setup();
  try{
    const result=await fixture.page.evaluate(async({unsigned,serverTime})=>{try{await window.YNXFinanceOrderWallet.begin(unsigned,serverTime);return 'accepted'}catch(error){return error.message}},{unsigned:vectors.positive.unsigned,serverTime:'2026-09-20T09:00:00.000Z'});
    assert.match(result,/PRIVATE_SERVICE_DEGRADED: Finance Endpoint Authority v2 is not configured/);
    assert.equal(await fixture.page.evaluate(()=>window.YNXFinanceOrderWallet.pending()),null);
  }finally{await fixture.context.close();}
});

test('isolated protocol fixture still validates the canonical approval, rejection and revocation flow without activating Web',()=>{
  const at=new Date('2026-09-19T09:00:01.000Z');
  const request=createFinanceOrderApprovalRequest(vectors.positive.unsigned,at);
  const approval=createSignedFinanceOrderApproval({accountSecret:vectors.positive.testOnlyPublicSecretScalarHex,approval:vectors.positive.unsigned},at);
  const approvedURL=createFinanceOrderApprovalReturnURL(registry,request,{status:'approved',approval},at);
  assert.match(approvedURL,/financeOrderApprovalResult=/);
  const rejectedURL=createFinanceOrderApprovalReturnURL(registry,request,{status:'rejected',reason:'USER_REJECTED'},at);
  assert.match(rejectedURL,/financeOrderApprovalResult=/);
  const revokedAt=new Date('2026-09-19T09:00:02.000Z');
  const revocation=createSignedFinanceOrderApprovalRevocation({accountSecret:vectors.positive.testOnlyPublicSecretScalarHex,approval},revokedAt);
  const revokedURL=createFinanceOrderApprovalReturnURL(registry,request,{status:'revoked',approval,revocation},revokedAt);
  assert.match(revokedURL,/financeOrderApprovalResult=/);
});
