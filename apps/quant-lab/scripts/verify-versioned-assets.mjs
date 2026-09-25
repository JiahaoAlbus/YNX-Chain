import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const ASSETS=Object.freeze(['styles.css','wallet-auth.js','i18n.js','app.js']);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function verifyQuantVersionedAssets(html,readAsset){
  if(typeof html!=='string'||typeof readAsset!=='function')throw new Error('QUANT_ASSET_INPUT_INVALID');
  const references=new Map();
  for(const match of html.matchAll(/\b(?:src|href)="(\/[^" ]+)"/gu)){
    const url=new URL(match[1],'https://quant.ynxweb4.com');
    const name=url.pathname.slice(1);
    if(/\.(?:js|css)$/u.test(name)&&!ASSETS.includes(name))throw new Error(`QUANT_UNTRACKED_PAGE_ASSET:${name}`);
    if(!ASSETS.includes(name))continue;
    if(url.search!==`?v=${sha256(readAsset(name))}`||url.hash)throw new Error(`QUANT_ASSET_HASH_MISMATCH:${name}`);
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
