// Non-authorizing installed candidate QA. It creates no Wallet/account and
// does not prove PUBLIC, private approval, provider output or native devices.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const runtime=process.env.YNX_BROWSER_NODE_MODULES||'/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const require=createRequire(path.join(runtime,'playwright/package.json'));
const {chromium}=require('playwright');
const root=path.resolve(import.meta.dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-ai-installed-qa-'));
const source=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const binary=path.join(dir,'ynx-ai-client');
execFileSync('go',['build','-ldflags',`-X main.buildCommit=${source} -X main.buildRelease=ai-consumer-local-qa`,'-o',binary,'./apps/ai'],{cwd:root});
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const base=`http://127.0.0.1:${port}`;
const env={...process.env,YNX_AI_CLIENT_STATE_PATH:path.join(dir,'state.json'),YNX_AI_CLIENT_CONTENT_KEY:randomBytes(32).toString('hex'),YNX_AI_GATEWAY_API_KEY:'isolated-non-provider-QA-key',YNX_AI_ALLOW_LOCAL_FIXTURE_AUTH:'0',YNX_AI_WALLET_GATEWAY_ORIGIN:'',YNX_AI_CLIENT_GATEWAY_URL:'http://127.0.0.1:1'};
const child=spawn(binary,['-http',`127.0.0.1:${port}`],{env,stdio:['ignore','ignore','pipe']});let logs='';child.stderr.on('data',value=>logs+=value.toString());
let browser;
try{
 for(let attempt=0;attempt<100;attempt++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));if(attempt===99)throw new Error('Candidate did not start: '+logs);}
 const meta=await fetch(base+'/api/meta').then(response=>response.json());assert.equal(meta.build.commit,source);assert.equal(meta.localFixtureAuthEnabled,false);
 browser=await chromium.launch({headless:true,executablePath:process.env.YNX_QA_CHROMIUM||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const outcomes=[];
 for(const viewport of [{width:1250,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto(base,{waitUntil:'networkidle'});
  await page.locator('#standard-wallet-ynx').click();await page.waitForFunction(()=>document.querySelector('#standard-wallet-status').textContent.includes('not available'));
  const state=await page.locator('#challenge-form').evaluate(form=>({hidden:form.hidden,display:getComputedStyle(form).display,rect:form.getBoundingClientRect().height,inert:form.inert}));
  assert.deepEqual(state,{hidden:true,display:'none',rect:0,inert:true});assert.equal(await page.locator('#auth-error').textContent(),'');assert.equal(await page.locator('#app').isVisible(),false);
  assert.equal(await page.locator('#standard-wallet-hosted').isVisible(),true);assert.equal(await page.locator('#standard-wallet-pair').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const screenshot=path.join(dir,`login-${viewport.width}.png`);await page.screenshot({path:screenshot,fullPage:true});outcomes.push({viewport,fixture:state,identityChangeNotice:false,webAndPhoneVisible:true,horizontalOverflow:false,screenshot});
 }
 assert.deepEqual(errors,[]);await context.close();
 const receipt={sourceCommit:source,binarySHA256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),installedLocalCandidate:true,publicAccepted:false,privateApprovalVerified:false,providerGenerationVerified:false,newAccounts:0,accountPermissionRequests:0,outcomes,pageErrors:errors};
 const file=path.join(dir,'receipt.json');fs.writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({receipt:file,...receipt}));
}finally{await browser?.close();child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve)});}
