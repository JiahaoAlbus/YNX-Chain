import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {chromium}=await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.match(runtime.qa,/^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
const tag=process.argv[3] || 'editor-actions';assert.match(tag,/^[a-z0-9-]{1,40}$/);
const filename=tag+'.ts',solname=tag+'.sol';
const source='before\nselected passage\nafter\n';
await writeFile(runtime.workspace+'/'+filename,source,{flag:'wx'});
await writeFile(runtime.workspace+'/'+solname,'pragma solidity 0.8.24; contract Actions {}\n',{flag:'wx'});
await writeFile(runtime.qa+'/'+tag+'-runner.mjs',await readFile(new URL(import.meta.url)),{flag:'wx'});
const browser=await chromium.launch({headless:true}), context=await browser.newContext(),page=await context.newPage();
const errors=[],checks=[],externalURLs=[],openedURLs=[];let clipboard='preserved unrelated clipboard',capture,compile;
await context.exposeBinding('__ynxActionsOpen',(_,value)=>{openedURLs.push(value);});
await context.exposeBinding('__ynxActionsWrite',(_,value)=>{clipboard=value;});
await context.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:value=>window.__ynxActionsWrite(value)}});const open=window.open.bind(window);window.open=(url,...args)=>{void window.__ynxActionsOpen(String(url));return open(url,...args);};});
await context.route('**/*',route=>{const url=route.request().url();if(new URL(url).origin===runtime.url)return route.continue();externalURLs.push(url);return route.abort();});
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(30000);
async function open(filename){await page.keyboard.press('Meta+p');await page.locator('input[placeholder^="Search files by name"]').fill(filename);await page.locator('.quick-input-list').getByText(filename,{exact:true}).filter({visible:true}).first().click();await page.waitForFunction(filename=>{const c=window.theia.container,id=[...c._bindingDictionary._map.keys()].find(id=>typeof id==='function'&&'currentEditor'in id.prototype&&typeof id.prototype.getByUri==='function');return c.get(id).currentEditor?.editor.uri.toString().endsWith('/'+filename);},filename);}
async function selection(selected){const value=await page.evaluate(selected=>{const c=window.theia.container,id=[...c._bindingDictionary._map.keys()].find(id=>typeof id==='function'&&'currentEditor'in id.prototype&&typeof id.prototype.getByUri==='function'),control=c.get(id).currentEditor.editor.getControl();control.focus();control.setSelection({startLineNumber:2,startColumn:1,endLineNumber:2,endColumn:selected?17:1});return control.getModel().getValueInRange(control.getSelection());},selected);await page.waitForFunction(selected=>{const c=window.theia.container,id=[...c._bindingDictionary._map.keys()].find(id=>typeof id==='function'&&typeof id.prototype.parseKeys==='function'&&typeof id.prototype.match==='function');return c.get(id).match('ynx.hasSelection')===selected;},selected);return value;}
async function menu(){await page.keyboard.press('Shift+F10');await page.getByText('YNX: Apply Reviewed Text Changes',{exact:true}).filter({visible:true}).first().waitFor();}
const visible=label=>page.getByText(label,{exact:true}).filter({visible:true});
try{
 await page.goto(runtime.url);await page.locator('#theia-app-shell').waitFor();await page.locator('.theia-preload').waitFor({state:'hidden'});
 await page.evaluate(async()=>{const c=window.theia.container,id=[...c._bindingDictionary._map.keys()].find(id=>typeof id==='function'&&typeof id.prototype.reachedState==='function'&&typeof id.prototype.doSetState==='function');await c.get(id).reachedState('ready');});
 const trust=page.getByRole('button',{name:'Yes, I trust the authors',exact:true});if(await trust.count())await trust.click();
 await open(filename);await selection(false);await menu();assert.equal(await visible('YNX: Review Selection with AI').count(),0);assert.equal(await visible('YNX: Compile Solidity Project').count(),0);await page.keyboard.press('Escape');checks.push('The real editor menu hides selection review without a selection and Solidity compile on a TypeScript file.');
 assert.equal(await selection(true),'selected passage');await menu();await visible('YNX: Review Selection with AI').first().click();await page.getByRole('button',{name:'Copy selection',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(clipboard,'preserved unrelated clipboard');assert.deepEqual(externalURLs,[]);checks.push('Right-click review reaches the real explicit-copy modal; cancellation preserves clipboard, source and opens no Tools page.');
 await selection(true);await page.keyboard.press('Meta+k');await page.keyboard.press('Meta+y');await page.getByRole('button',{name:'Copy selection',exact:true}).waitFor();await page.getByRole('button',{name:'Copy selection',exact:true}).click();
 for(let i=0;i<100&&!openedURLs.some(url=>url.endsWith('#ai'));i++)await page.waitForTimeout(50);
 capture=JSON.parse(clipboard);assert.equal(capture.selectedText,'selected passage');assert.equal(capture.sessionId,runtime.fixtureSessionId);assert.equal(capture.fullTextDigest,createHash('sha256').update(source).digest('hex'));
 assert.ok(openedURLs.some(url=>url===`https://developer.ynxweb4.com/native-tools?sessionId=${runtime.fixtureSessionId}#ai`));checks.push('The actual configured keyboard chord copies the exact selected document/version/digest and opens the AI anchor using only an opaque locator; all external requests are aborted in QA.');
 await page.bringToFront();await open(solname);await menu();await visible('YNX: Compile Solidity Project').first().click();await page.getByRole('button',{name:'Copy project sources',exact:true}).click();
 for(let i=0;i<100&&!openedURLs.some(url=>url.endsWith('#compile'));i++)await page.waitForTimeout(50);
 compile=JSON.parse(clipboard);assert.equal(compile.sessionId,runtime.fixtureSessionId);assert.deepEqual(Object.keys(compile.sources).sort(),(await readdir(runtime.workspace)).filter(name=>name.endsWith('.sol')).sort());assert.match(compile.sources[solname].content,/contract Actions/);assert.ok(openedURLs.some(url=>url===`https://developer.ynxweb4.com/native-tools?sessionId=${runtime.fixtureSessionId}#compile`));checks.push('The Solidity-only real context-menu action captures the project and opens the compiler anchor after explicit approval.');
 assert.equal(await readFile(runtime.workspace+'/'+filename,'utf8'),source);assert.equal(await readFile(runtime.workspace+'/'+solname,'utf8'),'pragma solidity 0.8.24; contract Actions {}\n');assert.deepEqual(errors,[]);checks.push('Both source files remain unchanged; no browser JavaScript errors, model request, compile execution or canonical admission is substituted.');
 await page.screenshot({path:runtime.qa+'/'+tag+'.png'});
} catch(error){errors.push({message:error.message,stack:error.stack});await page.screenshot({path:runtime.qa+'/'+tag+'-error.png'}).catch(()=>{});}
finally{await writeFile(runtime.qa+'/'+tag+'-ui.json',JSON.stringify({checks,errors,capture,compile,externalURLs,openedURLs,actualEditor:true,canonical:false,externalRequests:'aborted before network',scope:'Actual menus/chord and extension capture only; no hosted provider or normal-user release.'},null,2),{flag:'wx'});await browser.close();}
console.log(JSON.stringify({checks:checks.length,errors}));if(errors.length)process.exitCode=1;
