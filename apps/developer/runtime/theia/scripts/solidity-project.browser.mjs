import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium }=await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.match(runtime.qa,/^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);assert.equal(runtime.workspace,runtime.qa+'/project');
assert.match(runtime.fixtureSessionId,/^[a-f0-9-]{36}$/);
const tag=process.argv[3]||'solidity-project';assert.match(tag,/^[a-z0-9-]{1,40}$/);
await writeFile(runtime.qa+'/'+tag+'-runner.mjs',await readFile(fileURLToPath(import.meta.url)),{flag:'wx',mode:0o600});
await mkdir(runtime.workspace+'/contracts/lib',{recursive:true});
const saved='pragma solidity 0.8.24; contract PinCheck { function ping() external pure returns(uint256){return 1;} }\n';
const unsaved='pragma solidity 0.8.24; import "./lib/Math.sol"; contract PinCheck { function ping() external pure returns(uint256){return Math.value();} }\n';
const library='pragma solidity 0.8.24; library Math { function value() internal pure returns(uint256){return 3;} }\n';
async function fixture(path,text){try{await writeFile(path,text,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;assert.equal(await readFile(path,'utf8'),text);}}
await fixture(runtime.workspace+'/contracts/PinCheck.sol',saved);
await fixture(runtime.workspace+'/contracts/lib/Math.sol',library);
const browser=await chromium.launch({headless:true}),context=await browser.newContext({permissions:['clipboard-write']}),page=await context.newPage(),checks=[],errors=[],errorDetails=[];
await context.route('**/*',route=>new URL(route.request().url()).origin===runtime.url?route.continue():route.abort());
// Observe the real frontend clipboard/window transports in memory. Do not
// overwrite the user's OS clipboard or open a system/user browser.
await page.addInitScript(()=>{
 window.__qaSolidityCopies=[];window.__qaSolidityLocators=[];
 Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__qaSolidityCopies.push(text),readText:async()=>window.__qaSolidityCopies.at(-1)||''}});
 window.open=url=>{window.__qaSolidityLocators.push(String(url));return null;};
});
page.setDefaultTimeout(30000);page.on('pageerror',error=>{errors.push(error.message);errorDetails.push({message:error.message,stack:error.stack});});
async function command(name){await page.keyboard.press('Escape');await page.keyboard.press('F1');await page.locator('.quick-input-box input').fill('>'+name);await page.locator('.quick-input-list').getByText(name,{exact:true}).filter({visible:true}).first().click();}
async function open(name){await page.keyboard.press('Meta+p');await page.locator('input[placeholder^="Search files by name"]').fill(name);await page.locator('.quick-input-list').getByText(name,{exact:true}).filter({visible:true}).first().click();
 await page.waitForFunction(name=>{const container=window.theia.container,id=[...container._bindingDictionary._map.keys()].find(id=>typeof id==='function'&&'currentEditor' in id.prototype&&typeof id.prototype.getByUri==='function');return container.get(id).currentEditor?.editor.uri.toString().endsWith('/'+name);},name);
 await page.locator('.monaco-editor .view-lines').filter({visible:true}).last().click();
}
try{
 await page.goto(runtime.url);await page.locator('#theia-app-shell').waitFor();await page.locator('.theia-preload').waitFor({state:'hidden'});
 const trust=page.getByRole('button',{name:'Yes, I trust the authors',exact:true});if(await trust.count())await trust.click();
 await open('PinCheck.sol');await page.locator('.monaco-editor .view-lines').filter({visible:true}).last().click();await page.keyboard.press('Meta+a');await page.keyboard.insertText(unsaved);
 await command('YNX: Compile Solidity Project');await page.getByText(/Copy a snapshot of 2 Solidity file/).waitFor();
 await page.getByRole('button',{name:'Copy project sources',exact:true}).click();
 await page.waitForFunction(()=>window.__qaSolidityCopies.length===1&&window.__qaSolidityLocators.length===1);
 const observed=await page.evaluate(()=>({snapshot:JSON.parse(window.__qaSolidityCopies[0]),locator:window.__qaSolidityLocators[0]}));
 assert.equal(observed.snapshot.sessionId,runtime.fixtureSessionId);assert.equal(observed.snapshot.entryPath,'contracts/PinCheck.sol');assert.equal(observed.snapshot.sources[observed.snapshot.entryPath].content,unsaved);
 assert.equal(observed.snapshot.sources['contracts/lib/Math.sol'].content,library);assert.equal(Object.keys(observed.snapshot.sources).length,2);
 for(const row of Object.values(observed.snapshot.sources))assert.equal(row.sha256,createHash('sha256').update(row.content).digest('hex'));
 assert.equal(await readFile(runtime.workspace+'/contracts/PinCheck.sol','utf8'),saved);
 assert.equal(observed.locator,`https://developer.ynxweb4.com/native-tools?sessionId=${runtime.fixtureSessionId}#compile`);
 await writeFile(runtime.qa+'/'+tag+'-snapshot.json',JSON.stringify(observed.snapshot,null,2)+'\n',{flag:'wx',mode:0o600});
 checks.push('Real installed Tools0.2.8 command captures two canonical project sources, including unsaved active text, with actual VS Code API document versions/digests and a context-free locator.');
 await command('YNX: Compile Solidity Project');await page.getByText(/Copy a snapshot of 2 Solidity file/).waitFor();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Copy project sources',exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.__qaSolidityCopies.length),1);assert.equal(await page.evaluate(()=>window.__qaSolidityLocators.length),1);
 checks.push('Canceling the project-source review sends no clipboard payload or external locator.');
 await page.waitForTimeout(150);assert.deepEqual(errors,[]);
 await open('debug.js');await command('YNX: Compile Solidity Project');await page.getByText('Open a Solidity file in one active YNX project before capturing its sources.',{exact:true}).filter({visible:true}).first().waitFor();
 assert.equal(await page.evaluate(()=>window.__qaSolidityCopies.length),1);
 checks.push('An active non-Solidity file is refused without copying project data.');
 await page.screenshot({path:runtime.qa+'/'+tag+'.png',fullPage:true});assert.deepEqual(errors,[]);
}finally{await page.screenshot({path:runtime.qa+'/'+tag+'-last-state.png',fullPage:true}).catch(()=>{});await browser.close();await writeFile(runtime.qa+'/'+tag+'-ui.json',JSON.stringify({checks,errors,errorDetails,runtime,actualTheia:true,clipboard:'controlled frontend memory sink',externalWindow:'controlled frontend memory sink',canonicalAdmission:false,public:false},null,2),{flag:'wx',mode:0o600});}
console.log(JSON.stringify({checks:checks.length,errors}));
