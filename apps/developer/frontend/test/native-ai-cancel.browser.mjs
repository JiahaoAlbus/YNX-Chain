import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.YNX_QA_PLAYWRIGHT_MODULE||'playwright');
if(!process.env.YNX_QA_TOOLS_URL)throw Error('YNX_QA_TOOLS_URL must name the isolated native-tools fixture');
const browser=await chromium.launch({headless:true}),errors=[],calls=[];let passed=false,release;
try {
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));const held=new Promise(resolve=>release=resolve);let approvals=0;
 await page.route('**/runtime/native-tools/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();calls.push({path,body});let value;
  if(path.endsWith('/context'))value={csrf:'fresh',account:'account-A',projectId:'project-A',expiresAt:Date.now()+60000};
  else if(path.endsWith('/proposals'))value={...body,csrf:'approval',proposalId:'review-'+calls.length,contextBytes:5,model:'qwen3:4b'};
  else if(path.endsWith('/approve')){approvals++;if(approvals===1){await held;value={text:'RETIRED private plan'};}else value={text:'Current explicitly reviewed plan'};}
  else value={};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)}).catch(()=>{});
 });
 await page.goto(process.env.YNX_QA_TOOLS_URL);
 await page.getByLabel('Request',{exact:true}).fill('Suggest a plan');await page.getByLabel('Selected context',{exact:true}).fill('draft');
 await page.getByRole('button',{name:'Preview request'}).click();await page.getByRole('button',{name:'Send reviewed context once'}).click();
 await page.getByRole('button',{name:'Stop waiting for AI'}).click();
 await page.getByRole('alert').filter({hasText:'Context already sent cannot be recalled'}).waitFor();
 assert.equal(await page.getByLabel('Request',{exact:true}).inputValue(),'Suggest a plan');assert.equal(await page.getByLabel('Selected context',{exact:true}).inputValue(),'draft');
 assert.equal(await page.getByRole('button',{name:'Preview request'}).isEnabled(),true);assert.equal(approvals,1);
 await page.getByRole('button',{name:'Preview request'}).click();await page.getByRole('button',{name:'Send reviewed context once'}).click();
 await page.getByText('Current explicitly reviewed plan',{exact:true}).waitFor();release();await page.waitForTimeout(100);
 assert.equal(await page.getByText('RETIRED private plan',{exact:true}).count(),0);assert.equal(approvals,2);assert.deepEqual(errors,[]);passed=true;
} finally {release?.();await browser.close();if(process.env.YNX_QA_AI_CANCEL_RECEIPT)await writeFile(process.env.YNX_QA_AI_CANCEL_RECEIPT,JSON.stringify({passed,actualReact:true,actualChromium:true,backend:'controlled browser routes',errors,calls,realModel:false,public:false},null,2));}
console.log(JSON.stringify({passed,requests:calls.length,errors}));
