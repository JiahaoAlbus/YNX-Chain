import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { PROJECT_VIEWS, registerProjectViews } = require('./project-views.cjs');
test('project areas expose original actions and unavailable status without manufacturing commands', async () => {
  const providers = new Map(), commands = new Map(), calls = [], subscriptions = [];
  const sections = [{children:[{label:'Compile',command:'ynx.compileSolidity'}]}, {children:[{label:'Deployment unavailable',tooltip:'No signing authority'}]}, {children:[{label:'Review',command:'ynx.openLocalReview'}]}];
  registerProjectViews({window:{registerTreeDataProvider(id, provider){providers.set(id,provider);return {dispose(){providers.delete(id);}};}},commands:{registerCommand(id,fn){commands.set(id,fn);return{dispose(){commands.delete(id);}};},executeCommand(id){calls.push(id);}}}, {subscriptions}, sections);
  assert.deepEqual([...providers.keys()], PROJECT_VIEWS);
  for (let i=0;i<3;i++) assert.equal(providers.get(PROJECT_VIEWS[i]).getChildren(),sections[i].children);
  assert.equal(providers.get('ynx.contracts').getTreeItem(sections[0].children[0]).command.command,'ynx.compileSolidity');
  assert.equal(providers.get('ynx.network').getTreeItem(sections[1].children[0]).command,undefined);
  await commands.get('ynx.tools.focus')(); assert.deepEqual(calls,['ynx.contracts.focus']);
  subscriptions.forEach(item=>item.dispose()); assert.equal(providers.size,0);assert.equal(commands.size,0);
});
test('every project area has a contributed view, startup activation and bilingual label', () => {
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
  const views=Object.values(manifest.contributes.views).flat();
  for (const id of PROJECT_VIEWS) {assert.ok(views.some(v=>v.id===id));assert.ok(manifest.activationEvents.includes('onView:'+id));}
  for (const locale of ['package.nls.json','package.nls.zh-cn.json']) {
    const labels=JSON.parse(readFileSync(new URL('../'+locale,import.meta.url)));
    for (const view of views)assert.ok(labels[view.name.slice(1,-1)]);
    for (const container of manifest.contributes.viewsContainers.activitybar)assert.ok(labels[container.title.slice(1,-1)]);
  }
});

test('contract and review workflows belong to built-in project areas without a catch-all activity button', () => {
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
  assert.ok(manifest.contributes.views.explorer.some(view=>view.id==='ynx.contracts'));
  assert.ok(manifest.contributes.views.scm.some(view=>view.id==='ynx.review'));
  assert.equal(Object.values(manifest.contributes.views).flat().filter(view=>view.id==='ynx.contracts').length,1);
  assert.equal(Object.values(manifest.contributes.views).flat().filter(view=>view.id==='ynx.review').length,1);
  assert.ok(!manifest.contributes.viewsContainers.activitybar.some(row=>['ynx-contracts','ynx-review'].includes(row.id)));
  const toolbar=manifest.contributes.menus['editor/title'];
  for(const id of ['ynx.compileSolidity','ynx.evm.build','ynx.evm.test']) {
    const action=toolbar.find(row=>row.command===id);
    assert.equal(action.when,'resourceScheme == file && editorLangId == solidity');
    assert.ok(manifest.contributes.commands.some(row=>row.command===id));
  }
  assert.equal(toolbar.find(row=>row.command==='ynx.reviewSelection').when,'ynx.hasSelection && resourceScheme == file');
  assert.ok(!toolbar.some(row=>/chainProject|trackChain|configureChain/.test(row.command)));
});
