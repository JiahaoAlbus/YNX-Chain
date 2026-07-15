import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../web/styles.css',import.meta.url),'utf8');
const js=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
for(const required of ['<main','aria-live','conflict recovery','sign in with ynx wallet']) if(!html.toLowerCase().includes(required)) throw new Error(`missing ${required}`);
for(const required of ['prefers-reduced-motion','#002fa7']) if(!css.toLowerCase().includes(required)) throw new Error(`missing ${required}`);
for(const required of ['baseVersion','localStorage','presence','citations']) if(!js.includes(required)) throw new Error(`missing workflow ${required}`);
console.log('YNX Docs static, accessibility and recovery checks passed');
