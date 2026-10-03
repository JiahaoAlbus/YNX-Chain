import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {SUPPORTED_LOCALES,walletCopy,type WalletDetailMessage} from './i18n';
import {EXTRA_DETAIL_MESSAGES,EXTRA_DETAIL_LOCALES,extraWalletDetailCopy} from './detailLocale';
import {DETAIL_ACCOUNT_LOCALE} from './detailAccountLocale';
import {DETAIL_SESSION_LOCALE} from './detailSessionLocale';
import {DETAIL_TRANSFER_LOCALE} from './detailTransferLocale';
import {DETAIL_FAUCET_LOCALE} from './detailFaucetLocale';

function originalRows():[WalletDetailMessage,string,string][]{
  const source=ts.createSourceFile('i18n.ts',readFileSync(new URL('./i18n.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
  let result:[WalletDetailMessage,string,string][]=[];
  function visit(node:ts.Node){
    if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='DETAIL_MESSAGES'){
      let value=node.initializer!;while(ts.isAsExpression(value))value=value.expression;
      assert.ok(ts.isObjectLiteralExpression(value));
      result=value.properties.map(property=>{
        assert.ok(ts.isPropertyAssignment(property));assert.ok(ts.isStringLiteral(property.name));assert.ok(ts.isArrayLiteralExpression(property.initializer));
        const values=property.initializer.elements.map(item=>{assert.ok(ts.isStringLiteral(item));return item.text});
        assert.equal(values.length,2);return [property.name.text as WalletDetailMessage,values[0]!,values[1]!];
      });
    }
    ts.forEachChild(node,visit);
  }
  visit(source);return result;
}
const rows=originalRows();
const placeholders=(text:string)=>[...text.matchAll(/\{([a-zA-Z]+)\}/g)].map(match=>match[1]).sort();

test('all 205 original English, Simplified Chinese and Arabic entries remain byte-identical',()=>{
  assert.equal(rows.length,205);
  assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),'fc967a25526ffb0e0affb8e3ccda0998b0d8b5ad6a2cce14dad592531429fa66');
  for(const [key,zh,ar] of rows){assert.equal(walletCopy('en',key),key);assert.equal(walletCopy('zh-Hans',key),zh);assert.equal(walletCopy('ar',key),ar)}
});

test('nine missing languages cover the exact 205-key union once, with no implicit English fallback',()=>{
  const keys=[DETAIL_ACCOUNT_LOCALE,DETAIL_SESSION_LOCALE,DETAIL_TRANSFER_LOCALE,DETAIL_FAUCET_LOCALE].flatMap(Object.keys);
  assert.equal(keys.length,205);assert.equal(new Set(keys).size,205);
  assert.deepEqual([...EXTRA_DETAIL_MESSAGES].sort(),rows.map(row=>row[0]).sort());
  for(const locale of SUPPORTED_LOCALES)for(const [key] of rows){
    const text=walletCopy(locale,key);assert.ok(text.trim());assert.equal(text,text.trim());assert.doesNotMatch(text,/[\x00-\x1f\x7f]/);
    if(locale!=='en')assert.notEqual(text,key,locale+': '+key);
    assert.deepEqual(placeholders(text),placeholders(key),locale+': '+key);
  }
});

test('all localized substitutions preserve canonical values and never inherit prototype values',()=>{
  const values={nonce:'0007',fee:'1.000001 YNXT',count:7,devices:3,name:'ynx1_CANONICAL',asOf:'2026-10-03T12:00:00Z',expiresAt:'2026-10-04T12:00:00Z',code:'AUTH_EXACT_CODE'};
  for(const locale of SUPPORTED_LOCALES)for(const [key] of rows){
    const raw=walletCopy(locale,key),rendered=walletCopy(locale,key,values);
    for(const placeholder of placeholders(key)){assert.ok(rendered.includes(String(values[placeholder as keyof typeof values])),locale+': '+key)}
    assert.equal(rendered,raw.replace(/\{([a-zA-Z]+)\}/g,(token,key:string)=>Object.hasOwn(values,key)?String(values[key as keyof typeof values]):token));
    assert.equal(walletCopy(locale,key,Object.create(values)),raw);
  }
  for(const locale of EXTRA_DETAIL_LOCALES)for(const key of ['__proto__','constructor','uncatalogued'])
    assert.throws(()=>extraWalletDetailCopy(locale,key as WalletDetailMessage),/Unsupported Wallet detail copy/);
});

test('snapshot safety copy explicitly retains consensus qualification in every new language',()=>{
  const key='This mined transfer is covered by the node’s verified local snapshot checkpoint. This is not a consensus finality claim. Done acknowledges this result before another transfer can be signed.';
  const terms=['共識','合意','합의','consenso','consensus','Konsens','consenso','консенсус','konsensus'];
  EXTRA_DETAIL_LOCALES.forEach((locale,index)=>assert.ok(walletCopy(locale,key).includes(terms[index]!)));
});
