import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {INVOICE_REFERENCE_COPY} from '../src/wallet-locale-invoice-reference.mjs';
import {WALLET_LOCALES,WALLET_STATIC_COPY,WALLET_COPY,initWalletLocale,setWalletCopy} from '../src/wallet-locale.mjs';

const invoiceSelectors=Object.keys(WALLET_STATIC_COPY).filter(s=>s.includes('invoice')&&!s.includes('protected'));
function fakeDocument(){
  const doc={documentElement:{},querySelector:()=>null};
  const nodes=new Map(invoiceSelectors.map(selector=>[selector,{ownerDocument:doc,textContent:'',isConnected:true}]));
  doc.querySelectorAll=selector=>nodes.has(selector)?[nodes.get(selector)]:[];
  return {doc,nodes};
}
test('invoice display strings cover all locales and packaged runtime source',()=>{
  assert.deepEqual(Object.keys(INVOICE_REFERENCE_COPY).sort(),[...WALLET_LOCALES].sort());
  for(const locale of WALLET_LOCALES){
    for(const key of Object.keys(INVOICE_REFERENCE_COPY.en))assert.ok(INVOICE_REFERENCE_COPY[locale][key],`${locale}: ${key}`);
    for(const selector of invoiceSelectors)assert.ok(WALLET_COPY[locale][WALLET_STATIC_COPY[selector]],`${locale}: ${selector}`);
    assert.match(WALLET_COPY[locale]['Update pending · Last updated {time}'],/\{time\}/);
  }
  const metadata=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.ok(metadata.build.files.includes('src/**'));
});
test('locale switches update invoice safety text and dynamic status without changing input or facts',()=>{
  const {doc,nodes}=fakeDocument(),controller=initWalletLocale({document:doc});
  const input={value:'https://example.invalid/invoice/raw?token=unchanged'};
  const value={textContent:'merchant raw 0x123 1.20 YNXT'};
  const status={ownerDocument:doc,textContent:'',isConnected:true};
  const label={ownerDocument:doc,textContent:'',isConnected:true};
  const dynamic='Service response received. This is not a trusted signed invoice or payment receipt.';
  setWalletCopy(status,dynamic);setWalletCopy(label,'Reported merchant');
  const balance={ownerDocument:doc,textContent:'',isConnected:true};
  setWalletCopy(balance,'Update pending · Last updated {time}',{time:'10:42'});
  for(const locale of WALLET_LOCALES){
    controller.select(locale);
    for(const [selector,node] of nodes)assert.equal(node.textContent,WALLET_COPY[locale][WALLET_STATIC_COPY[selector]],`${locale}: ${selector}`);
    assert.equal(status.textContent,WALLET_COPY[locale][dynamic]);
    assert.equal(label.textContent,WALLET_COPY[locale]['Reported merchant']);
    assert.equal(balance.textContent,WALLET_COPY[locale]['Update pending · Last updated {time}'].replace('{time}','10:42'));
    assert.equal(input.value,'https://example.invalid/invoice/raw?token=unchanged');
    assert.equal(value.textContent,'merchant raw 0x123 1.20 YNXT');
  }
  status.textContent='new raw data';controller.select('zh-Hans');assert.equal(status.textContent,'new raw data');
});
test('actual renderer enrolls dynamic status and labels but preserves result data',()=>{
  const code=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');
  const section=code.slice(code.indexOf('const invoiceUI=createInvoiceReferenceUI'),code.indexOf('function clearInvoiceInput'));
  assert.match(section,/copyUI\(document\.querySelector\("#invoice-status"\)/);
  assert.match(section,/copyUI\(dt,label\);dd\.dir="ltr";dd\.textContent=value/);
});
