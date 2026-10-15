import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {realpath} from 'node:fs/promises';
let sequence=0;
async function page({mode='normal',main=null,ai=null,failCatalog=false}={}){
 const reads=[],writes=[],fetches=[],prefKeys=['ynx.creator.locale','ynx.creator.ai-locale'];let getters=0,reloads=0;
 class Select{constructor(){this.children=[];this.value='';this.attributes={};}replaceChildren(...children){this.children=children;}setAttribute(k,v){this.attributes[k]=v;}}
 const language=new Select(),aiLanguage=new Select(),label={dataset:{i18n:'overview'},textContent:'Original overview'};
 globalThis.document={documentElement:{lang:'en',dir:'ltr'},querySelectorAll:()=>[label],querySelector:key=>key==='#locale'?language:key==='#ai-locale'?aiLanguage:null};
 globalThis.Option=class{constructor(text,value){this.textContent=text;this.value=value;}};globalThis.location={reload(){reloads++;assert.fail('startup must not navigate');}};
 const storage={getItem(key){assert.ok(prefKeys.includes(key),'only two public preferences may be read');reads.push(key);if(mode==='method-error'||mode==='ai-error'&&key===prefKeys[1])throw new DOMException('unit optional preference unavailable','SecurityError');return key===prefKeys[0]?main:ai;},setItem(key,value){writes.push({key,value});assert.fail('startup must not write preferences or private data');}};
 Object.defineProperty(globalThis,'localStorage',mode==='getter-error'?{configurable:true,get(){getters++;throw new DOMException('unit storage access blocked','SecurityError');}}:{configurable:true,writable:true,value:storage});
 const sourceURL=process.env.YNX_CREATOR_I18N_SOURCE?pathToFileURL(process.env.YNX_CREATOR_I18N_SOURCE):new URL('./i18n.js',import.meta.url),url=pathToFileURL(await realpath(sourceURL));url.searchParams.set('unitCase',String(++sequence));const catalogURL=new URL('./i18n/catalog.json',url).href;
 globalThis.fetch=(input,options)=>{assert.equal(String(input),catalogURL);assert.equal(options,undefined);fetches.push(String(input));return failCatalog?Promise.reject(new TypeError('unit public catalog unavailable')):Promise.resolve(new Response(JSON.stringify({en:{language:'Language',aiLanguage:'AI language'}}),{headers:{'content-type':'application/json'}}));};
 const module=await import(url.href);
 return {module,language,aiLanguage,label,reads,writes,fetches,getters:()=>getters,reloads:()=>reloads,safe(){assert.ok(reads.every(k=>prefKeys.includes(k)));assert.equal(writes.length,0);assert.equal(reloads,0);assert.equal(fetches.length,1);}};
}
test('current stored Creator UI and independent AI locales still apply normally',async()=>{const p=await page({main:'ar',ai:'zh-CN'});await p.module.ready;assert.equal(document.documentElement.lang,'ar');assert.equal(document.documentElement.dir,'rtl');assert.equal(p.language.value,'ar');assert.equal(p.aiLanguage.value,'zh-CN');p.safe();});
test('unsupported stored public preferences retain original English fallback',async()=>{const p=await page({main:'unit-unknown',ai:'unit-unknown'});await p.module.ready;assert.equal(document.documentElement.lang,'en');assert.equal(p.language.value,'en');assert.equal(p.aiLanguage.value,'en');p.safe();});
test('independent valid AI preference does not change the current UI language',async()=>{const p=await page({main:'en',ai:'ar'});await p.module.ready;assert.equal(document.documentElement.dir,'ltr');assert.equal(p.language.value,'en');assert.equal(p.aiLanguage.value,'ar');p.safe();});
test('blocked optional getItem cannot reject Creator localization module initialization',async()=>{const p=await page({mode:'method-error'});await p.module.ready;assert.equal(p.module.t('overview'),'Overview');assert.equal(document.documentElement.lang,'en');assert.equal(p.aiLanguage.value,'en');assert.equal(p.reads.length,2);p.safe();});
test('blocked localStorage property access cannot reject Creator localization module initialization',async()=>{const p=await page({mode:'getter-error'});await p.module.ready;assert.equal(p.module.t('overview'),'Overview');assert.equal(p.language.value,'en');assert.equal(p.aiLanguage.value,'en');assert.equal(p.getters(),2);p.safe();});
test('AI preference read failure preserves the valid current Creator locale',async()=>{const p=await page({mode:'ai-error',main:'zh-CN'});await p.module.ready;assert.equal(document.documentElement.lang,'zh-CN');assert.equal(p.module.t('overview'),'概览');assert.equal(p.aiLanguage.value,'zh-CN');p.safe();});
test('blocked preferences do not replace original independent public catalog rejection',async()=>{const p=await page({mode:'method-error',failCatalog:true});await assert.rejects(p.module.ready,/unit public catalog unavailable/);assert.equal(p.module.t('overview'),'Overview');assert.equal(document.documentElement.lang,'en');p.safe();});
