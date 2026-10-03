import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {SUPPORTED_LOCALES,isRTL} from './i18n';
import {APP_FLOW_SOURCE} from './appFlowSource';
import {APP_FLOW_MESSAGES,allWalletAppFlowCopy,walletAppFlowCopy} from './appFlowCopy';

test('all 124 App flow messages explicitly cover every established Wallet locale without English fallback',()=>{
  assert.equal(APP_FLOW_MESSAGES.length,124);const copy=allWalletAppFlowCopy();assert.deepEqual(Object.keys(copy),[...SUPPORTED_LOCALES]);
  for(const locale of SUPPORTED_LOCALES){assert.deepEqual(Object.keys(copy[locale]),[...APP_FLOW_MESSAGES]);assert.ok(Object.isFrozen(copy[locale]));
    for(const message of APP_FLOW_MESSAGES){const value=copy[locale][message];assert.equal(typeof value,'string');assert.ok(value.length>0);assert.equal(value,value.trim());assert.doesNotMatch(value,/[\x00-\x1f\x7f]/);if(locale!=='en')assert.notEqual(value,message,`${locale}: ${message}`)}
  }
  assert.equal(isRTL('ar'),true);assert.ok(Object.isFrozen(copy));
});

test('module exactly covers A frozen App literals including every conditional branch; original zh-Hans is unchanged',()=>{
  // A may change the c wrapper/imports while retaining these exact literals.
  // Do not pin the whole App hash and reject that authorized composition.
  const bytes=readFileSync(new URL('../../App.tsx',import.meta.url));
  const source=ts.createSourceFile('App.tsx',bytes.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),pairs=new Map<string,string>();
  const strings=(node:ts.Node):string[]=>ts.isStringLiteralLike(node)?[node.text]:ts.isConditionalExpression(node)?[...strings(node.whenTrue),...strings(node.whenFalse)]:[];
  function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='c'){assert.equal(node.arguments.length,2);const en=strings(node.arguments[0]!),zh=strings(node.arguments[1]!);assert.equal(en.length,zh.length);assert.ok(en.length>0);en.forEach((message,i)=>{assert.ok(message in APP_FLOW_SOURCE,message);assert.equal(walletAppFlowCopy('en',message),message);assert.equal(walletAppFlowCopy('zh-Hans',message),zh[i]);pairs.set(message,zh[i]!)})}ts.forEachChild(node,visit)}
  visit(source);assert.deepEqual([...pairs.keys()].sort(),[...APP_FLOW_MESSAGES].sort());
});

test('unknown source strings, arbitrary data and unsupported locale are not an implicit fallback channel',()=>{
  for(const message of ['__proto__','constructor','inv_aaaaaaaaaaaaaaaaaaaa','ynx1-public-data','New uncatalogued text'])assert.throws(()=>walletAppFlowCopy('ar',message),/Unsupported Wallet App flow copy/);
  assert.throws(()=>walletAppFlowCopy('xx' as any,'Invoice'),/Unsupported Wallet App flow copy/);
});

test('safety notices retain explicit local-not-consensus and no-repeat semantics across languages',()=>{
  const consensus=['共識','合意','합의','consenso','consensus','Konsens','consenso','консенсус','إجماع','konsensus'];
  const locales=['zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id'] as const;
  const noRepeat=['不代表可以重新付款','再支払いは許可されません','다시 결제해도 된다는 뜻은 아닙니다','no permite pagar de nuevo','n’autorise pas un nouveau paiement','erlaubt keine erneute Zahlung','não permite pagar novamente','повторная оплата не разрешена','لا يجيز ذلك الدفع مجددًا','tidak mengizinkan pembayaran ulang'];
  const message='Checking observes the original hash only. Settlement actions use its retained intent and result, never another native transaction. An unknown response cannot permit paying again. A verified local checkpoint is not consensus finality.';
  locales.forEach((locale,i)=>{assert.ok(walletAppFlowCopy(locale,message).includes(consensus[i]!));assert.ok(walletAppFlowCopy(locale,'Saved receipts could not be verified. Original records are kept; this does not permit paying again.').includes(noRepeat[i]!))});
  for(const locale of SUPPORTED_LOCALES)for(const message of ['Receive YNXT','Contract address (lowercase 0x)','Only read-only pure/view methods can be used here.']){
    const token=message==='Receive YNXT'?'YNXT':message.startsWith('Contract')?'0x':'pure/view';assert.ok(walletAppFlowCopy(locale,message).includes(token));
  }
});
