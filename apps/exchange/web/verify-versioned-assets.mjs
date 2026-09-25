import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const PAGE_ASSETS=Object.freeze(['styles.css','wallet-connect.js','app.js']);
const MODULE_ASSETS=Object.freeze(['market-data.js','order-preview.js','private-session.js']);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function verifyExchangeVersionedAssets(html,app,readAsset){
  if(typeof html!=='string'||typeof app!=='string'||typeof readAsset!=='function')throw new Error('EXCHANGE_ASSET_INPUT_INVALID');
  const pageReferences=new Map();
  for(const match of html.matchAll(/\b(?:src|href)="(\/[^" ]+)"/gu)){
    const url=new URL(match[1],'https://exchange.ynxweb4.com');
    const name=url.pathname.slice(1);
    if(/\.(?:js|css)$/u.test(name)&&!PAGE_ASSETS.includes(name))throw new Error(`EXCHANGE_UNTRACKED_PAGE_ASSET:${name}`);
    if(!PAGE_ASSETS.includes(name))continue;
    if(url.search!==`?v=${sha256(readAsset(name))}`||url.hash)throw new Error(`EXCHANGE_ASSET_HASH_MISMATCH:${name}`);
    pageReferences.set(name,(pageReferences.get(name)??0)+1);
  }
  for(const name of PAGE_ASSETS)if(pageReferences.get(name)!==1)throw new Error(`EXCHANGE_PAGE_ASSET_MISSING_OR_DUPLICATE:${name}`);
  const moduleReferences=new Map();
  if(/\bimport\s*\(/u.test(app))throw new Error('EXCHANGE_DYNAMIC_MODULE_UNTRACKED');
  for(const match of app.matchAll(/\bfrom\s+['"](\.\/[^'"]+)['"]/gu)){
    const url=new URL(match[1],'https://exchange.ynxweb4.com/');
    const name=url.pathname.slice(1);
    if(!MODULE_ASSETS.includes(name))throw new Error(`EXCHANGE_UNTRACKED_MODULE:${name}`);
    if(url.search!==`?v=${sha256(readAsset(name))}`||url.hash)throw new Error(`EXCHANGE_MODULE_HASH_MISMATCH:${name}`);
    moduleReferences.set(name,(moduleReferences.get(name)??0)+1);
  }
  for(const name of MODULE_ASSETS)if(moduleReferences.get(name)!==1)throw new Error(`EXCHANGE_MODULE_MISSING_OR_DUPLICATE:${name}`);
  if([...app.matchAll(/(?:^|\n)\s*import\b/gu)].length!==MODULE_ASSETS.length)throw new Error('EXCHANGE_MODULE_IMPORT_UNTRACKED');
  return Object.freeze({status:'pass',pageAssets:PAGE_ASSETS.length,moduleAssets:MODULE_ASSETS.length});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.dirname(fileURLToPath(import.meta.url));
  const result=verifyExchangeVersionedAssets(readFileSync(path.join(root,'index.html'),'utf8'),readFileSync(path.join(root,'app.js'),'utf8'),name=>readFileSync(path.join(root,name)));
  console.log(JSON.stringify(result));
}
