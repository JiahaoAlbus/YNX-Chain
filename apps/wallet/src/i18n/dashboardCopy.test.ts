import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {SUPPORTED_LOCALES,type WalletLocale} from './i18n';
import {walletDashboardCopy,type WalletDashboardMessage} from './dashboardCopy';
import {WalletOperationLifecycle} from '../security/operationLifecycle';

const messages=['clipboardUnavailable','scan','contracts','confirmedHistory','payReceipts'] as const;
const app=readFileSync(new URL('../../App.tsx',import.meta.url),'utf8');
test('five Dashboard messages explicitly cover all twelve established locales',()=>{
  for(const message of messages)for(const locale of SUPPORTED_LOCALES){
    const value=walletDashboardCopy(locale,message);
    assert.ok(value.length>0);assert.equal(value,value.trim());assert.doesNotMatch(value,/[\x00-\x1f\x7f]/);
    if(locale!=='en')assert.notEqual(value,walletDashboardCopy('en',message));
    if(message==='payReceipts')assert.ok(value.includes('Pay'));
  }
});
test('unknown locale or message refuses without reflecting arbitrary input',()=>{
  for(const message of ['__proto__','constructor','toString','private-untrusted-value']){
    assert.throws(()=>walletDashboardCopy('en',message as WalletDashboardMessage),{message:'Unsupported Wallet dashboard copy'});
  }
  assert.throws(()=>walletDashboardCopy('unknown' as WalletLocale,'scan'),{message:'Unsupported Wallet dashboard copy'});
});
test('original English and Simplified Chinese Dashboard labels are preserved',()=>{
  const expected=[
    ['clipboardUnavailable','Clipboard unavailable. Open Receive and copy the address manually.','暂时无法复制。请打开收款页面并手动复制地址。'],
    ['scan','Scan QR code','扫一扫'],['contracts','Read native contracts','查询原生合约'],
    ['confirmedHistory','Confirmed transfer history','已确认转账记录'],['payReceipts','Pay payment receipts','Pay 付款收据'],
  ] as const;
  for(const [key,en,zh] of expected){assert.equal(walletDashboardCopy('en',key),en);assert.equal(walletDashboardCopy('zh-Hans',key),zh)}
});
test('actual Dashboard buttons use localized labels without changing their original actions',()=>{
  const source=ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const actions:Record<string,string>={scan:'openScan',contracts:'()=>setContracts(true)',confirmedHistory:'()=>setNativeHistory(true)',payReceipts:'()=>setPayHistory(true)'};
  const seen=new Set<string>();
  function visit(node:ts.Node){
    if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)==='SecondaryButton'){
      const attrs=node.attributes.properties.filter(ts.isJsxAttribute);
      const label=attrs.find(a=>a.name.getText(source)==='label')?.initializer;
      if(label&&ts.isJsxExpression(label)&&label.expression&&ts.isCallExpression(label.expression)&&label.expression.expression.getText(source)==='walletDashboardCopy'){
        const [locale,key]=label.expression.arguments;assert.equal(locale?.getText(source),'locale');assert.ok(key&&ts.isStringLiteral(key));
        const message=(key as ts.StringLiteral).text;assert.ok(Object.hasOwn(actions,message));assert.ok(!seen.has(message));seen.add(message);
        const action=attrs.find(a=>a.name.getText(source)==='onPress')?.initializer;
        assert.ok(action&&ts.isJsxExpression(action));assert.equal(action.expression?.getText(source),actions[message]);
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(source);assert.deepEqual([...seen].sort(),Object.keys(actions).sort());
});

// Run the actual production handler with controlled clipboard completion and
// the real operation lease. This is not an OS clipboard or biometric test.
function copyHarness(locale:WalletLocale){
  const handler=app.split('\n').find(line=>line.startsWith('  const copy=async()=>{if(publicCopyBusy.current)'));
  assert.ok(handler);const operations=new WalletOperationLifecycle();operations.setAccount('controlled-public-account');
  const unlock=operations.scope().begin({requireUnlocked:false});operations.unlock(unlock);unlock.finish();
  const scope=operations.scope(),busy={current:false},notice={current:0};let calls=0,error:string|null=null,copied=false;
  let reject!:(error:Error)=>void;
  const context={locale,walletDashboardCopy,selected:{account:'controlled-public-account'},publicCopyScope:scope,publicCopyBusy:busy,publicCopyNotice:notice,
    setCopyError:(value:string|null)=>{error=value},setCopied:(value:boolean)=>{copied=value},Clipboard:{},
    copyPublicValueWithExpiry:(_clipboard:unknown,account:string,{guard}:{guard:()=>void})=>{
      guard();assert.equal(account,'controlled-public-account');calls++;return new Promise<void>((_resolve,rejectPromise)=>{reject=rejectPromise});
    },setTimeout:()=>{throw Error('Failure path must not schedule success notice')}};
  const compiled=ts.transpileModule(handler+'\nreturn copy;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const copy=new Function(...Object.keys(context),compiled)(...Object.values(context)) as ()=>Promise<void>;
  return{copy,operations,scope,busy,reject:()=>reject(Error('controlled clipboard unavailable')),state:()=>({calls,error,copied})};
}
test('actual clipboard failure handler localizes all twelve languages and releases single-flight for retry',async()=>{
  for(const locale of SUPPORTED_LOCALES){
    const h=copyHarness(locale),pending=h.copy();await h.copy();assert.equal(h.state().calls,1);
    h.reject();await pending;assert.deepEqual(h.state(),{calls:1,error:walletDashboardCopy(locale,'clipboardUnavailable'),copied:false});assert.equal(h.busy.current,false);
    const retry=h.copy();assert.equal(h.state().calls,2);h.reject();await retry;
  }
});
test('actual late clipboard failure cannot publish across original account, lock, background or cancelled scope',async()=>{
  for(const boundary of ['account','lock','background','cancel'] as const)for(const locale of SUPPORTED_LOCALES){
    const h=copyHarness(locale),pending=h.copy();
    if(boundary==='account')h.operations.setAccount('other-controlled-account');
    if(boundary==='lock')h.operations.lock();if(boundary==='background')h.operations.setAppState('background');if(boundary==='cancel')h.scope.cancel();
    h.reject();await pending;assert.deepEqual(h.state(),{calls:1,error:null,copied:false});
  }
});
