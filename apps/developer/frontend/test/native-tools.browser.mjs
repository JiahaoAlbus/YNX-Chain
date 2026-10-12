import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
if (!process.env.YNX_QA_TOOLS_URL) throw new Error('YNX_QA_TOOLS_URL must name the isolated native-tools fixture with sessionId');
const browser = await chromium.launch({headless:true}), checks = [], errors = [], modelCalls = [];
try {
  const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/runtime/native-tools/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let value, status = 200;
    if (path.endsWith('/context')) value = {csrf:'fresh',account:'account-A',projectId:'project-A',expiresAt:Date.now()+60000};
    else if (path.endsWith('/proposals')) value = {...route.request().postDataJSON(),csrf:'approval',proposalId:'review-A',contextBytes:5,model:'qwen3:4b'};
    else if (path.endsWith('/approve')) { modelCalls.push(route.request().postDataJSON()); value = {text:'Private plan from account A'}; }
    else { status=401; value = {code:'tools_identity_changed',error:'Wallet session changed. Sign in again.'}; }
    return route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  });
  await page.goto(process.env.YNX_QA_TOOLS_URL);
  await page.getByLabel('Request',{exact:true}).fill('Suggest a plan');
  await page.getByLabel('Selected context',{exact:true}).fill('draft');
  await page.getByRole('button',{name:'Preview request'}).click();
  await page.getByRole('button',{name:'Send reviewed context once'}).click();
  await page.getByText('Private plan from account A',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Check Wallet readiness'}).click();
  await page.getByRole('alert').filter({hasText:'Wallet session changed'}).waitFor();
  assert.equal(await page.getByText('Private plan from account A',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Send reviewed context once'}).count(),0);
  await page.getByRole('link',{name:'Sign in with YNX Wallet'}).waitFor();
  assert.equal(modelCalls.length,1,'authorization failure must not resend model context');
  checks.push('401 retires old Tools identity, private result and approval; sign-in returns; no hidden model retry');
  assert.deepEqual(errors,[]);
} finally {
  await browser.close();
  if (process.env.YNX_QA_TOOLS_RECEIPT) await writeFile(process.env.YNX_QA_TOOLS_RECEIPT,JSON.stringify({checks,errors,modelCalls:modelCalls.length,actualChromium:true,actualReactTools:true,backend:'controlled HTTP routes',public:false},null,2));
}
console.log(JSON.stringify({checks,errors,modelCalls:modelCalls.length}));
