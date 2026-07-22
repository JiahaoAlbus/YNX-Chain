import {readFile} from 'node:fs/promises';
for (const path of ['web/index.html','web/styles.css','web/mobile.css','web/app.js']) {
  const text=await readFile(new URL(`../${path}`,import.meta.url),'utf8');
  if(!text.trim()) throw new Error(`${path} is empty`);
}
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
for(const required of ['<main','aria-live','aria-label','Sign in with YNX Wallet','selected-context','prefers-reduced-motion']) {
  if(!html.includes(required)&&!(await readFile(new URL('../web/styles.css',import.meta.url),'utf8')).includes(required)) throw new Error(`missing accessibility/product marker: ${required}`);
}
for(const required of ['id="erase-dialog"','id="erase-authorize"','id="erase-confirm"','id="erase-receipts"','DELETE CLOUD DATA'])if(!html.includes(required))throw new Error(`missing product-data erasure UI marker: ${required}`);
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const routineScopes=app.match(/const scopes=\[([^\]]+)\]/)?.[1]||'';
if(routineScopes.includes('data.delete')||!app.includes("requestedScopes=erasing?['data.delete']:scopes")||!app.includes("token:state.erasureToken"))throw new Error('erasure must use a separate least-privilege Wallet session');
const {locales,erasureT}=await import('../web/i18n.js');
for(const locale of locales)for(const key of ['open','title','intro','export','authorize','confirm','erase','receipts','complete','pending','purpose'])if(!erasureT(locale,key)?.trim())throw new Error(`missing ${locale} erasure ${key}`);
for(const file of ['observability/dashboard.json','observability/alerts.json']){
  const value=JSON.parse(await readFile(new URL(`../${file}`,import.meta.url),'utf8'));
  if(value.schemaVersion!==1)throw new Error(`${file} schema is not versioned`);
}
const dashboard=JSON.parse(await readFile(new URL('../observability/dashboard.json',import.meta.url),'utf8'));
const alerts=JSON.parse(await readFile(new URL('../observability/alerts.json',import.meta.url),'utf8'));
if(dashboard.authenticationScope!=='audit.read'||dashboard.panels.length<6)throw new Error('observability dashboard is incomplete');
if(alerts.deliveryStatus!=='not-configured'||alerts.rules.length!==4)throw new Error('alert delivery boundary is unclear');
console.log('YNX Cloud static, accessibility and product-boundary checks passed');
