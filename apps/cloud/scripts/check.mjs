import {readFile} from 'node:fs/promises';
for (const path of ['web/index.html','web/styles.css','web/mobile.css','web/app.js']) {
  const text=await readFile(new URL(`../${path}`,import.meta.url),'utf8');
  if(!text.trim()) throw new Error(`${path} is empty`);
}
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
for(const required of ['<main','aria-live','aria-label','Sign in with YNX Wallet','selected-context','prefers-reduced-motion']) {
  if(!html.includes(required)&&!(await readFile(new URL('../web/styles.css',import.meta.url),'utf8')).includes(required)) throw new Error(`missing accessibility/product marker: ${required}`);
}
console.log('YNX Cloud static, accessibility and product-boundary checks passed');
