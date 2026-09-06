import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const code=(await readFile(new URL('./i18n.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const catalog=JSON.parse(await readFile(new URL('./i18n/catalog.json',import.meta.url),'utf8'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function languagePage(href){
 const location={href,search:new URL(href).search,reloads:0,reload(){this.reloads++;},assign(url){this.assigned=String(url);}};
 const select={value:'',replaceChildren(){},setAttribute(){}};
 const stored=new Map();
 const dependencies={location,localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)},URL,URLSearchParams,
  Option:class{constructor(label,value){this.label=label;this.value=value;}},
  document:{documentElement:{},querySelector:()=>select,querySelectorAll:()=>[]},
  fetch:async()=>({ok:true,json:async()=>catalog})};
 const executable=code.replace('import.meta.url',JSON.stringify('https://video.ynxweb4.com/i18n.js'));
 await new AsyncFunction(...Object.keys(dependencies),executable+'\nawait ready;')(...Object.values(dependencies));
 return {location,select,stored,document:dependencies.document};
}
for(const locale of Object.keys(catalog))test(`language selection updates an existing URL override to ${locale} without losing the video deep link`,async()=>{
 const p=await languagePage('https://video.ynxweb4.com/?lang=zh-CN&video=vid_guest#main');
 p.select.value=locale;p.select.onchange();
 const next=new URL(p.location.assigned??p.location.href);
 assert.equal(next.searchParams.get('lang'),locale);
 assert.equal(next.searchParams.get('video'),'vid_guest');
 assert.equal(next.hash,'#main');
 const returned=await languagePage(next.href);
 assert.equal(returned.document.documentElement.lang,locale);
 assert.equal(returned.document.documentElement.dir,locale==='ar'?'rtl':'ltr');
});
