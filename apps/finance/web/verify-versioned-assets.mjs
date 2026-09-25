import {createHash} from 'node:crypto';

const ASSETS=Object.freeze([
  'manifest.webmanifest','ynx-logo.png','styles.css','finance-locale.js',
  'wallet-auth.js','order-wallet.js','order-opaque.js','evm-read-session.js',
  'evm-subject.js','app.js','read-sources.js','product-catalog.js',
]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

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
    if(count!==(name==='ynx-logo.png'?2:1))throw new Error(`FINANCE_ASSET_BINDING_MISSING_OR_DUPLICATE:${name}`);
  }
  return Object.freeze({status:'pass',assets:ASSETS.length,versionedReferences:[...actual.values()].reduce((sum,count)=>sum+count,0)});
}
