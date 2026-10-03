import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const {chromium}=await import(process.env.YNX_QA_PLAYWRIGHT_MODULE||'playwright');
if(!process.env.YNX_QA_TOOLS_URL)throw Error('YNX_QA_TOOLS_URL is required');
const browser=await chromium.launch({headless:true}),checks=[],errors=[],calls=[];let passed=false;
const sessionId='12345678-1234-1234-1234-123456789012',source='before\nselected passage\nafter\n',capture={uri:'file:///project/a.ts',version:4,fullTextDigest:createHash('sha256').update(source).digest('hex'),selectedText:'selected passage',sessionId};
const edit={summary:'Change selected passage',bundle:{protocol:'ynx-reviewed-text/v1',sessionId,changes:[{uri:capture.uri,version:capture.version,fullTextDigest:capture.fullTextDigest,replacements:[{find:capture.selectedText,replace:'new passage'}]}]}};
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__reviewCopied=value;}}}));
 const record={id:'00000000-0000-4000-8000-000000000001',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),model:'qwen3:4b',status:'completed',prompt:'Improve selection',context:JSON.stringify(capture),text:JSON.stringify({summary:edit.summary,replacement:'new passage'}),edit};
 await page.route('**/runtime/native-tools/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();calls.push({path,body});let status=200,value;
  if(path.endsWith('/context'))value={csrf:'fresh',account:'account-A',projectId:'project-A',expiresAt:Date.now()+60000};
  else if(path.endsWith('/proposals')){assert.equal(body.mode,'selected-edit');assert.deepEqual(JSON.parse(body.context),capture);value={...body,csrf:'review',proposalId:'selection-1',model:'qwen3:4b',contextBytes:body.context.length,wirePrompt:'Exact reviewed selection',requestBytes:200,mode:'selected-edit'};}
  else if(path.endsWith('/approve'))value={text:record.text,edit,saved:true,applied:false,signed:false};
  else if(path.endsWith('/ai/conversations'))value={conversations:[record]};
  else if(path.endsWith('/'+record.id))value={conversation:record};
  else{status=401;value={error:'Wallet project session ended.',code:'tools_identity_changed'};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.goto(process.env.YNX_QA_TOOLS_URL);
 await page.getByLabel('Review mode',{exact:true}).selectOption('selected-edit');
 await page.getByLabel('Request',{exact:true}).fill('Improve selection');await page.getByLabel('Selected context',{exact:true}).fill(JSON.stringify(capture));
 await page.getByRole('button',{name:'Preview request',exact:true}).click();
 assert.equal(calls.filter(call=>call.path.endsWith('/approve')).length,0);
 await page.getByRole('button',{name:'Send reviewed context once',exact:true}).click();await page.getByRole('heading',{name:'Suggested replacement',exact:true}).waitFor();
 await page.getByRole('button',{name:'Copy editor review bundle',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Review bundle copied'}).waitFor();
 assert.deepEqual(JSON.parse(await page.evaluate(()=>window.__reviewCopied)),edit.bundle);
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download editor review bundle',exact:true}).click();const download=await downloading;
 assert.equal(download.suggestedFilename(),'ynx-reviewed-text.json');assert.deepEqual(JSON.parse(await readFile(await download.path(),'utf8')),edit.bundle);
 checks.push('Explicit selected-edit preview and one-use send produce exact copied and downloaded version/digest/session-bound replacement; no apply');
 await page.getByText('Saved AI requests',{exact:true}).click();await page.getByRole('button',{name:'Load saved requests',exact:true}).click();
 await page.getByRole('button',{name:/^Open .*completed$/}).click();
 await page.getByRole('heading',{name:'Saved request · completed',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Download editor review bundle',exact:true}).count(),2);
 assert.equal(calls.filter(call=>call.path.endsWith('/approve')).length,1);checks.push('Saved selected edit reopens with review bundle and no model replay');
 await page.getByRole('button',{name:'Check Wallet readiness',exact:true}).click();await page.getByRole('link',{name:'Sign in with YNX Wallet',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Download editor review bundle',exact:true}).count(),0);
 assert.equal(await page.getByRole('heading',{name:'Suggested replacement',exact:true}).count(),0);
 checks.push('Retired native identity removes generated and saved private edit bundles');
 assert.deepEqual(errors,[]);passed=true;
}finally{await browser.close();if(process.env.YNX_QA_SELECTED_EDIT_RECEIPT)await writeFile(process.env.YNX_QA_SELECTED_EDIT_RECEIPT,JSON.stringify({passed,checks,errors,calls,actualReact:true,actualChromium:true,backend:'controlled browser HTTP fixtures',public:false,nativeEditorJourney:'NOT_RUN'},null,2));}
console.log(JSON.stringify({passed,checks,errors}));
