import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const directory=new URL('./',import.meta.url),origin='http://127.0.0.1:54321';
const source=fs.readFileSync(new URL('sw.js',directory),'utf8'),html=fs.readFileSync(new URL('index.html',directory),'utf8');
const scripts=[...html.matchAll(/<script\s+defer\s+src="([^"]+)"/g)].map(m=>m[1]);
async function worker(){const handlers=new Map(),stored=new Map();const caches={open:async()=>({addAll:async urls=>{for(const url of urls)stored.set(origin+url,fs.readFileSync(new URL(url==='/'?'index.html':url.slice(1),directory),'utf8'));}}),keys:async()=>[],match:async request=>stored.get(typeof request==='string'?new URL(request,origin).href:request.url),delete:async()=>true};vm.runInNewContext(source,{URL,self:{location:{origin},addEventListener:(type,fn)=>handlers.set(type,fn)},caches,fetch:async()=>{throw Error('controlled offline route');}});let installed;handlers.get('install')({waitUntil:p=>installed=p});await installed;return{handlers,stored};}
test('cold offline shell resolves every script required by the actual HTML without caching helper APIs',async()=>{
 const {handlers,stored}=await worker();assert.ok(scripts.length>=6);assert.equal(stored.get(origin+'/'),html);
 for(const file of scripts){let response;handlers.get('fetch')({request:{method:'GET',url:origin+file},respondWith:p=>response=p});assert.ok(response,'offline runtime missing '+file);assert.equal(await response,fs.readFileSync(new URL(file.slice(1),directory),'utf8'),file);}
 for(const [method,url]of [['POST',origin+'/api/governance-proposals'],['GET',origin+'/api/status'],['GET','https://rpc.ynxweb4.com/status']]){let intercepted=false;handlers.get('fetch')({request:{method,url},respondWith:()=>intercepted=true});assert.equal(intercepted,false,url);}assert.equal([...stored.keys()].some(key=>key.includes('/api/')),false);
});
test('new install manifest uses the requested default white launch surface',()=>{const manifest=JSON.parse(fs.readFileSync(new URL('manifest.webmanifest',directory),'utf8'));assert.equal(manifest.background_color,'#ffffff');assert.equal(manifest.theme_color,'#ffffff');assert.match(html,/name="theme-color" content="#ffffff"/);});
