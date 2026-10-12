import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime=JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa,/^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
const source='// SPDX-License-Identifier: MIT\n// 中文😀\npragma solidity 0.8.24;\nimport "./lib/Math.sol";\ncontract Use { function ping() public pure returns(uint256) { return Math.value(); } }\n';
const library='// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\nlibrary Math { function value() internal pure returns(uint256) { return 3; } function value(uint256 n) internal pure returns(uint256) { return n; } }\n';
await mkdir(runtime.workspace+'/contracts/lib',{recursive:true});
await writeFile(runtime.workspace+'/contracts/Use.sol',source,{flag:'wx'});
await writeFile(runtime.workspace+'/contracts/lib/Math.sol',library,{flag:'wx'});
const browser=await chromium.launch({headless:true}), page=await browser.newPage(), checks=[], errors=[];
page.setDefaultTimeout(20000);
await page.route('**/*',route=>new URL(route.request().url()).origin===runtime.url?route.continue():route.abort());
async function current(position) {
  return page.evaluate(position=>{
    const c=window.theia.container,id=[...c._bindingDictionary._map.keys()].find(id=>typeof id==='function'&&'currentEditor' in id.prototype&&typeof id.prototype.getByUri==='function');
    const editor=c.get(id).currentEditor.editor, control=editor.getControl();
    if(position)control.setPosition(position);control.focus();
    return {uri:editor.uri.toString(),text:control.getModel().getValue()};
  },position);
}
async function open(file) {
  await page.keyboard.press('Meta+p');await page.locator('input[placeholder^="Search files by name"]').fill(file);
  await page.locator('.quick-input-list').getByText(file,{exact:true}).filter({visible:true}).first().click();
  await page.locator('.quick-input-box input').waitFor({state:'hidden'});
  await page.waitForFunction(file=>{
    const c=window.theia.container,id=[...c._bindingDictionary._map.keys()].find(id=>typeof id==='function'&&'currentEditor' in id.prototype&&typeof id.prototype.getByUri==='function');
    return c.get(id).currentEditor?.editor.uri.toString().endsWith('/'+file);
  },file);
  await current();
}
let passed=false;
try {
  await page.goto(runtime.url);await page.locator('.theia-preload').waitFor({state:'hidden'});
  await page.evaluate(async()=>{
    const c=window.theia.container,id=[...c._bindingDictionary._map.keys()].find(id=>typeof id==='function'&&typeof id.prototype.reachedState==='function'&&typeof id.prototype.doSetState==='function');
    await c.get(id).reachedState('ready');
  });
  const trust=page.getByRole('button',{name:'Yes, I trust the authors',exact:true});if(await trust.count())await trust.click();
  await open('Use.sol');
  const column=source.split('\n')[4].indexOf('Math.value')+6;
  await current({lineNumber:5,column});await page.keyboard.press('F2');
  await page.locator('.rename-box input').filter({visible:true}).fill('fresh');
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('Math.fresh'));
  assert.ok((await current()).text.includes('Math.fresh()'));
  await open('Math.sol');assert.ok((await current()).text.includes('function fresh()'));assert.ok((await current()).text.includes('function value(uint256'));
  checks.push('Cold F2 performs one cross-file rename and preserves the other overload.');
  await page.screenshot({path:runtime.qa+'/coding-rename.png'});
  await open('Use.sol');await current({lineNumber:5,column});
  await page.keyboard.press('Control+Shift+ArrowRight');await page.keyboard.type('fr');
  await page.keyboard.press('Control+Space');
  const suggestion=page.locator('.suggest-widget .monaco-list-row').filter({visible:true}).filter({hasText:'fresh'}).first();
  await suggestion.waitFor();await page.screenshot({path:runtime.qa+'/coding-completion.png'});
  await page.keyboard.press('Enter');assert.ok((await current()).text.includes('Math.fresh()'));
  checks.push('Ordinary partially typed member completion accepts the current cross-file declaration.');
  await current({lineNumber:5,column});await page.keyboard.press('Control+Shift+ArrowRight');await page.keyboard.type('missing');
  await page.waitForFunction(()=>document.querySelector('.squiggly-error'));
  await page.screenshot({path:runtime.qa+'/coding-diagnostics.png'});
  checks.push('Editing to an unknown member automatically displays a real compiler error without copying diagnostic JSON.');
  await page.keyboard.press('Meta+z');
  await page.waitForFunction(()=>!document.querySelector('.squiggly-error'));
  assert.ok((await current()).text.includes('Math.fresh()'));
  checks.push('Undo fixes the active source and retires the previous compiler error.');
  await page.keyboard.press('Meta+s');
  assert.equal(await readFile(runtime.workspace+'/contracts/Use.sol','utf8'),source.replace('Math.value()', 'Math.fresh()'));
  assert.equal(await readFile(runtime.workspace+'/contracts/lib/Math.sol','utf8'),library.replace('function value()', 'function fresh()'));
  checks.push('The standard rename and save persist both project files with the overload intact.');
  await page.keyboard.press('F1');await page.locator('.quick-input-box input').fill('>YNX: Compile Solidity Project');
  await page.locator('.quick-input-list').getByText('YNX: Compile Solidity Project',{exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('"bytecode"'));
  assert.ok((await current()).text.includes('"contractName": "Use"'));
  const artifact=JSON.parse((await current()).text);assert.ok(artifact.bytecode.length>2);assert.ok(artifact.abi.some(row=>row.name==='ping'));
  checks.push('One standard compile command opens the real local ABI and bytecode artifact without a browser or copied JSON.');
  await open('Use.sol');const beforeFormat=(await current()).text;
  await page.keyboard.press('Alt+Shift+f');
  await page.waitForFunction(()=>{
    const c=window.theia.container,id=[...c._bindingDictionary._map.keys()].find(id=>typeof id==='function'&&'currentEditor' in id.prototype&&typeof id.prototype.getByUri==='function');
    return c.get(id).currentEditor.editor.getControl().getModel().getLineCount()>8;
  });
  assert.ok((await current()).text.includes('function ping()'));
  await page.screenshot({path:runtime.qa+'/coding-format.png'});
  await current();await page.keyboard.press('Meta+z');assert.equal((await current()).text,beforeFormat);
  checks.push('Standard Format Document uses the retained Nomic/Prettier formatter and its edit can be undone.');
  passed=true;
}catch(error){errors.push({message:error.message,stack:error.stack});await page.screenshot({path:runtime.qa+'/coding-error.png'}).catch(()=>{});}
finally{await browser.close();await writeFile(runtime.qa+'/coding-ui.json',JSON.stringify({passed,checks,errors,realEditor:true,canonical:false,public:false,sourceWrites:'Only owned fixture files through normal rename, keyboard edits and Save.'},null,2),{flag:'wx'});console.log(JSON.stringify({passed,checks,errors}));if(!passed)process.exitCode=1;}
