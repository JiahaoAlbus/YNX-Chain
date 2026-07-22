import {readFile} from 'node:fs/promises';
for (const path of ['web/index.html','web/styles.css','web/mobile.css','web/app.js']) {
  const text=await readFile(new URL(`../${path}`,import.meta.url),'utf8');
  if(!text.trim()) throw new Error(`${path} is empty`);
}
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
for(const required of ['<main','aria-live','aria-label','Sign in with YNX Wallet','selected-context','prefers-reduced-motion']) {
  if(!html.includes(required)&&!(await readFile(new URL('../web/styles.css',import.meta.url),'utf8')).includes(required)) throw new Error(`missing accessibility/product marker: ${required}`);
}
for(const file of ['observability/dashboard.json','observability/alerts.json']){
  const value=JSON.parse(await readFile(new URL(`../${file}`,import.meta.url),'utf8'));
  if(value.schemaVersion!==1)throw new Error(`${file} schema is not versioned`);
}
const dashboard=JSON.parse(await readFile(new URL('../observability/dashboard.json',import.meta.url),'utf8'));
const alerts=JSON.parse(await readFile(new URL('../observability/alerts.json',import.meta.url),'utf8'));
if(dashboard.authenticationScope!=='audit.read'||dashboard.panels.length<6)throw new Error('observability dashboard is incomplete');
if(alerts.deliveryStatus!=='not-configured'||alerts.rules.length!==4)throw new Error('alert delivery boundary is unclear');
console.log('YNX Cloud static, accessibility and product-boundary checks passed');
