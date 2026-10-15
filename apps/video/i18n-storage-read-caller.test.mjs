import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {realpath} from 'node:fs/promises';
let sequence=0;
async function page({mode='normal',stored=null,requested=null,failCatalog=false}={}){
 const reads=[],writes=[],fetches=[];let getters=0,navigations=0;
 const select={value:'',children:[],attributes:{},replaceChildren(...children){this.children=children;},setAttribute(k,v){this.attributes[k]=v;}};
 const label={dataset:{i18n:'discover'},textContent:'Original Discover'},placeholder={dataset:{i18nPlaceholder:'search'},setAttribute(k,v){this[k]=v;}};
 globalThis.document={documentElement:{lang:'en',dir:'ltr'},querySelectorAll:key=>key==='[data-i18n]'?[label]:[placeholder],querySelector:key=>key==='#locale'?select:null};globalThis.Option=class{constructor(text,value){this.textContent=text;this.value=value;}};
 const url=new URL('https://video.ynxweb4.com/app.html?video=unit-public-video');if(requested!==null)url.searchParams.set('lang',requested);globalThis.location={href:url.href,search:url.search,assign(){navigations++;assert.fail('startup must not navigate');}};
 const storage={getItem(key){assert.equal(key,'ynx.video.locale');reads.push(key);if(mode==='method-error')throw new DOMException('unit optional locale unavailable','SecurityError');return stored;},setItem(key,value){writes.push({key,value});assert.fail('startup must not write preferences/private data');}};
 Object.defineProperty(globalThis,'localStorage',mode==='getter-error'?{configurable:true,get(){getters++;throw new DOMException('unit storage access blocked','SecurityError');}}:{configurable:true,writable:true,value:storage});
 const sourceURL=process.env.YNX_VIDEO_I18N_SOURCE?pathToFileURL(process.env.YNX_VIDEO_I18N_SOURCE):new URL('./i18n.js',import.meta.url),moduleURL=pathToFileURL(await realpath(sourceURL));moduleURL.searchParams.set('unitCase',String(++sequence));const catalogURL=new URL('./i18n/catalog.json',moduleURL).href;
 globalThis.fetch=(input,options)=>{assert.equal(String(input),catalogURL);assert.equal(options,undefined);fetches.push(String(input));return failCatalog?Promise.reject(new TypeError('unit public Video catalog unavailable')):Promise.resolve(new Response(JSON.stringify({en:{discover:'Discover',search:'Search',language:'Language'},ar:{discover:'اكتشف'},'zh-CN':{discover:'发现'},fr:{discover:'Découvrir'},ja:{discover:'見つける'}}),{headers:{'content-type':'application/json'}}));};
 const module=await import(moduleURL.href);
 return {module,select,label,reads,writes,fetches,getters:()=>getters,safe(){assert.ok(reads.every(k=>k==='ynx.video.locale'));assert.equal(writes.length,0);assert.equal(navigations,0);assert.equal(fetches.length,1);assert.equal(location.href,url.href);}};
}
test('current Video stored locale without URL override remains unchanged',async()=>{const p=await page({stored:'fr'});await p.module.ready;assert.equal(document.documentElement.lang,'fr');assert.equal(p.select.value,'fr');assert.equal(p.label.textContent,'Découvrir');p.safe();});
test('current explicit URL locale still overrides independent stored locale',async()=>{const p=await page({stored:'zh-CN',requested:'ar'});await p.module.ready;assert.equal(document.documentElement.lang,'ar');assert.equal(document.documentElement.dir,'rtl');assert.equal(p.select.value,'ar');p.safe();});
test('unsupported URL locale still retains supported stored preference',async()=>{const p=await page({stored:'ja',requested:'unit-unknown'});await p.module.ready;assert.equal(document.documentElement.lang,'ja');assert.equal(p.label.textContent,'見つける');p.safe();});
test('blocked optional Video getItem does not reject language module initialization',async()=>{const p=await page({mode:'method-error'});await p.module.ready;assert.equal(document.documentElement.lang,'en');assert.equal(p.module.t('discover'),'Discover');assert.equal(p.reads.length,1);p.safe();});
test('blocked localStorage access still allows the explicit URL Arabic locale',async()=>{const p=await page({mode:'getter-error',requested:'ar'});await p.module.ready;assert.equal(document.documentElement.lang,'ar');assert.equal(document.documentElement.dir,'rtl');assert.equal(p.getters(),1);p.safe();});
test('blocked stored preference preserves explicit URL Chinese language selection',async()=>{const p=await page({mode:'method-error',requested:'zh-CN'});await p.module.ready;assert.equal(document.documentElement.lang,'zh-CN');assert.equal(p.label.textContent,'发现');p.safe();});
test('blocked optional Video preference does not replace independent public catalog rejection',async()=>{const p=await page({mode:'method-error',failCatalog:true});await assert.rejects(p.module.ready,/unit public Video catalog unavailable/);assert.equal(p.module.t('unitUnknown'),'unitUnknown');p.safe();});
