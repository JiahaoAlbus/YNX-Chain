import {createHash} from 'node:crypto';

const ASSETS=Object.freeze([
  'manifest.webmanifest','ynx-logo.png','ynx-favicon.png','styles.css','finance-locale.js',
  'wallet-auth.js','order-wallet.js','order-opaque.js','evm-read-session.js',
  'evm-subject.js','app.js','read-sources.js','product-catalog.js',
]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export function verifyFinanceIntroductionAssets(html,readAsset){
  const names=['introduction.css','introduction.js','ynx-logo.png','finance-workspace-preview.png'];
  const counts=new Map();
  for(const match of html.matchAll(/\b(?:src|href)="(\/[^" ]+)"/gu)){
    const url=new URL(match[1],'https://finance.ynxweb4.com'),name=url.pathname.slice(1);
    if(!names.includes(name)){if(/\.(?:js|css|png)$/u.test(name))throw new Error('FINANCE_INTRO_UNKNOWN_ASSET');continue}
    if(url.search!==`?v=${digest(readAsset(name))}`||url.hash)throw new Error(`FINANCE_INTRO_HASH_MISMATCH:${name}`);
    counts.set(name,(counts.get(name)??0)+1);
  }
  for(const name of names)if(counts.get(name)!==1)throw new Error(`FINANCE_INTRO_ASSET_MISSING_OR_DUPLICATE:${name}`);
  return {status:'pass',assets:names.length};
}

export function verifyFinanceVersionedAssets(html,readAsset){
  if(typeof html!=='string'||typeof readAsset!=='function')throw new Error('FINANCE_ASSET_INPUT_INVALID');
  const actual=new Map();
  for(const match of html.matchAll(/\b(?:src|href)="(\/[^" ]+)"/gu)){
    const url=new URL(match[1],'https://finance.ynxweb4.com');
    const name=url.pathname.slice(1);
    if(!ASSETS.includes(name))continue;
    const expected=digest(readAsset(name));
    if(url.search!==`?v=${expected}`||url.hash)throw new Error(`FINANCE_ASSET_HASH_MISMATCH:${name}`);
    actual.set(name,(actual.get(name)??0)+1);
  }
  for(const name of ASSETS){
    const count=actual.get(name)??0;
    // Desktop/mobile brands and three existing YNX wallet choices each carry
    // the exact original logo. This is an exact count, not a relaxed minimum.
    if(count!==(name==='ynx-logo.png'?5:1))throw new Error(`FINANCE_ASSET_BINDING_MISSING_OR_DUPLICATE:${name}`);
  }
  return Object.freeze({status:'pass',assets:ASSETS.length,versionedReferences:[...actual.values()].reduce((sum,count)=>sum+count,0)});
}
