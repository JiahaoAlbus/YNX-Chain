import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const ASSETS=Object.freeze(['styles.css','wallet-auth.js','i18n.js','app.js','ui-preferences.js','ynx-brand-logo.png']);
export const QUANT_APPLICATION_ASSETS=ASSETS;
const INTRO_ASSETS=Object.freeze(['introduction.css','introduction.js','quant-workspace-preview.png','ynx-brand-logo.png']);
export const QUANT_RUNTIME_WEB_ASSETS=Object.freeze(['index.html',...ASSETS,'introduction.html',...INTRO_ASSETS.filter(name=>!ASSETS.includes(name))]);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function verifyQuantIntroductionAssets(html,readAsset){
  const counts=new Map();
  for(const match of html.matchAll(/\b(?:src|href)="(\/[^" ]+)"/gu)){
    const url=new URL(match[1],'https://quant.ynxweb4.com'),name=url.pathname.slice(1);
    if(!INTRO_ASSETS.includes(name)){if(/\.(?:js|css|png)$/u.test(name))throw new Error('QUANT_INTRO_UNKNOWN_ASSET');continue}
    if(url.search!==`?v=${sha256(readAsset(name))}`||url.hash)throw new Error(`QUANT_INTRO_HASH_MISMATCH:${name}`);
    counts.set(name,(counts.get(name)??0)+1);
  }
  for(const name of INTRO_ASSETS)if(counts.get(name)!==1)throw new Error(`QUANT_INTRO_MISSING_OR_DUPLICATE:${name}`);
  return {status:'pass',assets:INTRO_ASSETS.length};
}

export function verifyQuantVersionedAssets(html,readAsset){
  if(typeof html!=='string'||typeof readAsset!=='function')throw new Error('QUANT_ASSET_INPUT_INVALID');
  const references=new Map();
  for(const match of html.matchAll(/\b(?:src|href)="(\/[^" ]+)"/gu)){
    const url=new URL(match[1],'https://quant.ynxweb4.com');
    const name=url.pathname.slice(1);
    if(/\.(?:js|css|png)$/u.test(name)&&!ASSETS.includes(name))throw new Error(`QUANT_UNTRACKED_PAGE_ASSET:${name}`);
    if(!ASSETS.includes(name))continue;
    const bytes=readAsset(name);
    if(name.endsWith('.png')&&!Buffer.from(bytes).subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw new Error('QUANT_IMAGE_INVALID');
    if(url.search!==`?v=${sha256(bytes)}`||url.hash)throw new Error(`QUANT_ASSET_HASH_MISMATCH:${name}`);
    references.set(name,(references.get(name)??0)+1);
  }
  for(const name of ASSETS)if(references.get(name)!==1)throw new Error(`QUANT_ASSET_BINDING_MISSING_OR_DUPLICATE:${name}`);
  return Object.freeze({status:'pass',assets:ASSETS.length});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../web');
  const result=verifyQuantVersionedAssets(readFileSync(path.join(root,'index.html'),'utf8'),name=>readFileSync(path.join(root,name)));
  console.log(JSON.stringify(result));
}
