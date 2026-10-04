import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {applyLanguage,zh} from '../public/about/about.mjs';
import {buildCardIntroduction} from '../scripts/build-card-introduction.mjs';
const root=resolve(import.meta.dirname,'..');
test('introduction keeps canonical app CTA and has no wallet or navigation launcher',async()=>{
  const html=await readFile(join(root,'public/about/index.html'),'utf8');
  assert.match(html,/<html lang="en" translate="no"/);assert.match(html,/name="google" content="notranslate"/);
  assert.equal((html.match(/href="\/"/g)||[]).length,3);assert.doesNotMatch(html,/target=|iframe|ynxwallet:\/\/|eth_requestAccounts/);
  for(const key of [...html.matchAll(/data-(?:copy|alt)="([^"]+)"/g)].map(m=>m[1]))assert.equal(typeof zh[key],'string',key);
});
test('locale is explicit, reversible and uses only the existing app preference',()=>{
  const node={dataset:{copy:'open'},textContent:'Open web app'},image={dataset:{alt:'artAlt'},alt:'Illustration'},button={setAttribute(key,value){this[key]=value}};
  const document={documentElement:{lang:'en'},querySelectorAll:selector=>selector==='[data-copy]'?[node]:[image],getElementById:()=>button};
  const writes=[],storage={setItem:(...args)=>writes.push(args)};
  applyLanguage(document,null,'en');assert.equal(node.textContent,'Open web app');assert.equal(writes.length,0);
  applyLanguage(document,storage,'zh-CN');assert.equal(node.textContent,zh.open);assert.equal(document.documentElement.lang,'zh-CN');
  applyLanguage(document,storage,'en');assert.equal(node.textContent,'Open web app');assert.equal(image.alt,'Illustration');assert.deepEqual(writes,[['ynx-card.secure.v1.locale','zh-CN'],['ynx-card.secure.v1.locale','en']]);
  assert.doesNotThrow(()=>applyLanguage(document,{setItem(){throw Error('blocked storage')}},'en'));
});
test('build copies source-owned introduction and original assets without replacing root app',async()=>{
  const output=await mkdtemp(join(tmpdir(),'ynx-card-introduction-'));await buildCardIntroduction({root,output});
  assert.deepEqual((await readdir(join(output,'about'))).sort(),['about.css','about.mjs','card-testnet-identity.svg','index.html','ynx-logo.png']);
  for(const asset of ['ynx-logo.png','card-testnet-identity.svg'])assert.deepEqual(await readFile(join(output,'about',asset)),await readFile(join(root,'assets',asset)));
  assert.deepEqual(await readdir(output),['about']);
});
