import test from 'node:test';
import assert from 'node:assert/strict';
import {realpath} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
let sequence=0;
async function page(){
 const values=new Map([['ynx.creator.locale','en'],['ynx.creator.ai-locale','ja'],['wallet.session','preserve'],['draft','preserve draft'],['UNKNOWN','preserve unknown']]),writes=[],reads=[];let mode='normal',reloads=0;
 class Select{value='';children=[];attributes={};replaceChildren(...children){this.children=children;}setAttribute(k,v){this.attributes[k]=v;}}
 const language=new Select(),ai=new Select(),label={dataset:{i18n:'overview'},textContent:''};
 globalThis.document={documentElement:{lang:'en',dir:'ltr'},querySelectorAll:()=>[label],querySelector:key=>key==='#locale'?language:key==='#ai-locale'?ai:null};globalThis.Option=class{constructor(text,value){this.textContent=text;this.value=value;}};globalThis.location={reload(){reloads++;if(mode==='reload-error')throw new TypeError('unit navigation failure');}};
 const storage={getItem(k){assert.ok(['ynx.creator.locale','ynx.creator.ai-locale'].includes(k));reads.push(k);return values.get(k)??null;},setItem(k,v){assert.ok(['ynx.creator.locale','ynx.creator.ai-locale'].includes(k));writes.push({key:k,value:v});if(mode==='method-error')throw new DOMException('unit public preference quota','QuotaExceededError');values.set(k,v);}};
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){if(mode==='getter-error')throw new DOMException('unit preference access blocked','SecurityError');return storage;}});
 const source=process.env.YNX_CREATOR_I18N_SOURCE?pathToFileURL(process.env.YNX_CREATOR_I18N_SOURCE):new URL('./i18n.js',import.meta.url),url=pathToFileURL(await realpath(source));url.searchParams.set('unitWriteCase',String(++sequence));let fetches=0;
 globalThis.fetch=(input,options)=>{assert.equal(String(input),new URL('./i18n/catalog.json',url).href);assert.equal(options,undefined);fetches++;return Promise.resolve(new Response(JSON.stringify({en:{language:'Language',aiLanguage:'AI language'}}),{headers:{'content-type':'application/json'}}));};
 const module=await import(url.href);await module.ready;
 return {module,language,ai,label,values,writes,reloads:()=>reloads,setMode(value){mode=value;},safe(){assert.equal(fetches,1);assert.deepEqual(reads,['ynx.creator.locale','ynx.creator.ai-locale']);assert.equal(values.get('wallet.session'),'preserve');assert.equal(values.get('draft'),'preserve draft');assert.equal(values.get('UNKNOWN'),'preserve unknown');}};
}
test('normal UI language persists exact public key then follows original reload',async()=>{const p=await page();p.language.value='ar';p.language.onchange();assert.deepEqual(p.writes,[{key:'ynx.creator.locale',value:'ar'}]);assert.equal(p.reloads(),1);assert.equal(p.values.get('ynx.creator.ai-locale'),'ja');p.safe();});
for(const mode of ['method-error','getter-error']){
 test(`UI ${mode} applies the selected locale on-page and keeps independent current AI choice`,async()=>{const p=await page();p.ai.value='zh-CN';p.language.value='ar';p.setMode(mode);assert.doesNotThrow(()=>p.language.onchange());assert.equal(document.documentElement.lang,'ar');assert.equal(document.documentElement.dir,'rtl');assert.equal(p.label.textContent,'نظرة عامة');assert.equal(p.language.value,'ar');assert.equal(p.ai.value,'zh-CN');assert.equal(p.values.get('ynx.creator.locale'),'en');assert.equal(p.reloads(),0);p.language.value='en';p.language.onchange();assert.equal(document.documentElement.dir,'ltr');assert.equal(p.label.textContent,'Overview');assert.equal(p.ai.value,'zh-CN');p.safe();});
}
test('normal independent AI language writes only its own public key without navigation',async()=>{const p=await page();p.ai.value='ar';p.ai.onchange();assert.deepEqual(p.writes,[{key:'ynx.creator.ai-locale',value:'ar'}]);assert.equal(p.reloads(),0);assert.equal(document.documentElement.lang,'en');p.safe();});
for(const mode of ['method-error','getter-error']){
 test(`AI ${mode} keeps current DOM selection without uncaught exception or UI locale change`,async()=>{const p=await page();p.ai.value='zh-CN';p.setMode(mode);assert.doesNotThrow(()=>p.ai.onchange());assert.equal(p.ai.value,'zh-CN');assert.equal(p.values.get('ynx.creator.ai-locale'),'ja');assert.equal(document.documentElement.lang,'en');assert.equal(p.reloads(),0);p.safe();});
}
test('successful storage does not swallow the original independent navigation exception',async()=>{const p=await page();p.language.value='ar';p.setMode('reload-error');assert.throws(()=>p.language.onchange(),/unit navigation failure/);assert.equal(p.reloads(),1);assert.equal(p.values.get('ynx.creator.locale'),'ar');p.safe();});
