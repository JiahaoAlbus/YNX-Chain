import {chromium} from '/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const cssPath='apps/social/web/workspace.css',uiPath='apps/social/web/matrix/restricted-moments-ui.mjs';
const css=await fs.readFile(cssPath,'utf8'),bundle=await fs.readFile('/tmp/ynx-social-restricted-ui-proof.js','utf8');
const out='apps/social/evidence/moments-ui/20261002';
const receipt={schema:'ynx-social-moments-select-ui/v1',syntheticTransport:true,syntheticText:true,publicRuntimeVerified:false,realAuthorityVerified:false,checks:[],consoleErrors:[],sourceSha256:{}};
for(const path of [cssPath,uiPath])receipt.sourceSha256[path]=crypto.createHash('sha256').update(await fs.readFile(path)).digest('hex');
const browser=await chromium.launch({headless:true});
try{
 for(const width of [1280,390,320]){
  const page=await browser.newPage({viewport:{width,height:900}});
  page.on('pageerror',error=>receipt.consoleErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')receipt.consoleErrors.push(message.text())});
  await page.setContent('<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="matrix-social-workspace"></main></body></html>');
  await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});
  await page.evaluate(()=>{
   const binding={userId:'@fixture:example.invalid'};
   RestrictedUI.createRestrictedMomentsUI({container:document.querySelector('main'),transport:{},capture:()=>({account:'synthetic',operation:{binding}}),guard:()=>{},identity:async()=>{},work:async action=>action()});
   document.querySelector('select option').textContent='已接受的好友：中文长名称与跨节点身份 / Reviewed friends with a very long audience label';
  });
  const facts=await page.locator('select').evaluate(select=>{
   const style=getComputedStyle(select),box=select.getBoundingClientRect();
   return {height:box.height,fontSize:style.fontSize,color:style.color,background:style.backgroundColor,disabled:select.disabled,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.ok(facts.height>=44);assert.equal(facts.fontSize,'16px');assert.equal(facts.color,'rgb(0, 47, 167)');assert.equal(facts.background,'rgb(255, 255, 255)');assert.equal(facts.disabled,true);assert.equal(facts.overflow,false);
  // Enable only the native select to inspect keyboard focus, not publishing.
  await page.locator('select').evaluate(select=>{select.disabled=false});await page.keyboard.press('Tab');
  const focus=await page.locator('select').evaluate(select=>({focused:document.activeElement===select,outline:getComputedStyle(select).outlineWidth}));
  assert.equal(focus.focused,true);assert.equal(focus.outline,'3px');
  await page.screenshot({path:`${out}/select-${width}.png`});
  receipt.checks.push({width,...facts,focus});await page.close();
 }
 assert.equal(receipt.consoleErrors.length,0);
 await fs.writeFile(`${out}/receipt.json`,JSON.stringify(receipt,null,2)+'\n');
 process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
}finally{await browser.close()}
