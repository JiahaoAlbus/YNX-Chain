import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const PAGE_ASSETS=Object.freeze(['styles.css','wallet-connect.js','app.js','ui-preferences.js']);
const MODULE_ASSETS=Object.freeze(['market-data.js','order-preview.js','private-session.js','locale.js','command-review.js','command-copy.js','venue-config.js']);
const IMAGE_ASSETS=Object.freeze(['ynx-logo.png','ynx-favicon.png']);
export const EXCHANGE_RUNTIME_WEB_ASSETS=Object.freeze(['index.html',...new Set([...PAGE_ASSETS,...MODULE_ASSETS,...IMAGE_ASSETS]),'introduction.html','introduction.css','introduction.js','exchange-workspace-preview.png']);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function verifyExchangeIntroductionAssets(html,readAsset){
  const expected=['introduction.css','introduction.js','ynx-logo.png','ynx-favicon.png','exchange-workspace-preview.png'];
  const seen=[];
  for(const match of html.matchAll(/\b(?:src|href)="(\/[^" ]+)"/gu)){
    const url=new URL(match[1],'https://exchange.ynxweb4.com'),name=url.pathname.slice(1);
    if(!/\.(?:js|css|png)$/u.test(name))continue;
    if(!expected.includes(name)||url.search!==`?v=${sha256(readAsset(name))}`||url.hash)throw new Error(`EXCHANGE_INTRODUCTION_ASSET_INVALID:${name}`);
    seen.push(name);
  }
  if(JSON.stringify(seen.sort())!==JSON.stringify(expected.sort()))throw new Error('EXCHANGE_INTRODUCTION_ASSET_SET_INVALID');
  return {status:'pass',assets:expected.length};
}

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
  const imageReferences=new Map();
  for(const match of html.matchAll(/\b(?:src|href)="(\/[^" ]+)"/gu)){
    const url=new URL(match[1],'https://exchange.ynxweb4.com'),name=url.pathname.slice(1);
    if(!/\.(?:png|svg|ico|webp|jpg|jpeg)$/u.test(name))continue;
    if(!IMAGE_ASSETS.includes(name))throw new Error(`EXCHANGE_UNTRACKED_IMAGE:${name}`);
    const bytes=readAsset(name);
    if(url.search!==`?v=${sha256(bytes)}`||url.hash)throw new Error(`EXCHANGE_IMAGE_HASH_MISMATCH:${name}`);
    if(!Buffer.from(bytes).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error(`EXCHANGE_IMAGE_FORMAT_INVALID:${name}`);
    imageReferences.set(name,(imageReferences.get(name)??0)+1);
  }
  for(const name of IMAGE_ASSETS)if(imageReferences.get(name)!==1)throw new Error(`EXCHANGE_IMAGE_MISSING_OR_DUPLICATE:${name}`);
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
