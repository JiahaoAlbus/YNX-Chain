import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const web=join(import.meta.dirname,'..','web');
const source=readFileSync(join(web,'finance-locale.js'),'utf8');
const html=readFileSync(join(web,'index.html'),'utf8');
const locales=['en','zh-CN','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id'];

function fixture(saved=null){
  const storage=new Map(saved?[['ynx-finance-locale',saved]]:[]),selectors=new Map();
  const document={readyState:'complete',documentElement:{lang:'en',dir:'ltr'},querySelector:selector=>selectors.get(selector)??null,querySelectorAll:()=>[],dispatchEvent(){}};
  const selection={value:'en',addEventListener(){},setAttribute(name,value){this[name]=value}};
  selectors.set('#finance-language',selection);
  const window={};
  const exposed=source.replace('window.YNXFinanceLocale=Object.freeze','window.__messages=messages;window.YNXFinanceLocale=Object.freeze');
  runInNewContext(exposed,{window,document,localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}}});
  return {window,document,selection,storage};
}

test('all twelve Finance locales have complete nonblank UI copy and selection options',()=>{
  const {window}=fixture();
  assert.deepEqual(Array.from(window.YNXFinanceLocale.supported),locales);
  const keys=Object.keys(window.__messages.en);
  assert.equal(keys.length,474);
  for(const locale of locales){
    assert.match(html,new RegExp(`<option value="${locale}"`));
    const messages=window.__messages[locale];
    assert.deepEqual(Object.keys(messages),keys,locale);
    for(const key of keys){
      assert.equal(typeof messages[key],'string',`${locale}:${key}`);
      assert.ok(messages[key].trim(),`${locale}:${key}`);
      assert.doesNotMatch(messages[key],/ZXQ|⟦YNXK|\n/u,`${locale}:${key}`);
    }
  }
  for(const key of ['testMarketUnverified','brokerApprovalIntro','walletRejected','brokerRiskSimple','evmSubjectReady','evmSubjectDenied','evmSubjectRevokePending']){
    for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  }
  for(const key of ['noAlerts','alertsInformational','noOwnedActivity','noExplorerActivity','noReceiptPlaceholders','noOwnedPayReceipts'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  for(const key of ['planningOnly','partialObservation','noCompletePeriodHistory','observedSpending','remainingBudget','noReminders'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  for(const key of ['statementCoverageInvalid','fullPeriodTotals','completeHistoryMissing','observedFees','notBankStatement'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  for(const key of ['aiNoOwnedActivity','aiConsentRequired','aiProviderUnavailable','aiStatusReady','aiStatusRejected'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  for(const key of ['supportHelp','supportDispute','aiDraftIncomplete','aiDeleteConfirm','aiDraftDeleted'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  for(const key of ['activityScopeIntro','planningNoControl','statementScopeIntro','aiScopeIntro','supportNoReversal'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  for(const key of ['aiIntentUnavailable','aiSymbolInvalid','aiSideInvalid','aiQtyInvalid','aiLimitInvalid'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  for(const key of ['indexedRecords','exportObservedCsv','activityDirection','generateStatement','workflowLabel'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  for(const key of ['privateProductState','addCategory','limitInYnxt','recurringReminders','frequencyLabel','nextDate'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  for(const key of ['aiDraftOnly','aiWorkflowCategorize','aiWorkflowBroker','aiAdvisoryNotice','aiConsentDetails','aiRequestDraft'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  for(const key of ['leastPrivilege','includePayStatements','sourceAlertsHelp','productBoundary','protocolIntro','principalRisk'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
  for(const key of ['recentOwnedActivity','readOnlyPortfolio','waitingExplorer','sourceBoundedRecord','choosePeriod'])for(const locale of locales.filter(value=>value!=='en'))assert.notEqual(window.__messages[locale][key],window.__messages.en[key],`${locale}:${key}`);
});

test('reviewed financial terminology keeps execution, reconciliation, test assets and token allowance distinct',()=>{
  const {window}=fixture(),copy=window.__messages;
  const expected={
    ja:{brokerStatePartial:/一部約定/u,brokerStateFilled:/約定済み/u,brokerCancelLegacy:/照合/u,testDraftResult:/トークン承認額/u,testMarketUnverified:/Hardhat/u},
    ko:{brokerStatePartial:/일부 체결/u,brokerStateFilled:/체결 완료/u,testDraftResult:/토큰 승인 한도/u},
    de:{brokerStatePartial:/teilweise ausgeführt/u,brokerStateFilled:/ausgeführt/u,brokerCancelLegacy:/Auftragsstatus ab/u,testDraftResult:/Token-Freigabe/u},
    pt:{brokerStatePartial:/Parcialmente executada/u,brokerStateFilled:/Executada/u,brokerCancelLegacy:/Concilie o estado/u,testMarketUnverified:/Hardhat/u,testDraftResult:/autorização do token/u},
    ru:{brokerStatePartial:/Частично исполнен/u,brokerStateFilled:/Исполнен/u,brokerCancelLegacy:/Сверьте статус/u,testMarketUnverified:/Hardhat/u},
    ar:{brokerRiskSimple:/مُحاكاة/u,brokerStateFilled:/نُفّذ الأمر/u,testDraftResult:/حد تفويض الرمز/u},
    'zh-Hant':{boundary:/證據/u,brokerSimulatedUSD:/模擬美元/u},
  };
  for(const [locale,checks] of Object.entries(expected))for(const [key,pattern] of Object.entries(checks))assert.match(copy[locale][key],pattern,`${locale}:${key}`);
  for(const locale of locales)assert.notEqual(copy[locale].evmSubjectReady,copy[locale].evmSubjectDenied,`${locale}:approval and rejection must remain distinct`);
});

test('locale selection persists, maps legacy Simplified Chinese, and toggles RTL without changing protocol values',()=>{
  const {window,document,selection,storage}=fixture('zh-Hans');
  assert.equal(window.YNXFinanceLocale.get(),'zh-CN');
  assert.equal(document.documentElement.lang,'zh-CN');
  assert.equal(window.YNXFinanceLocale.set('ar'),true);
  assert.equal(document.documentElement.dir,'rtl');
  assert.equal(selection.value,'ar');
  assert.equal(storage.get('ynx-finance-locale'),'ar');
  assert.equal(window.YNXFinanceLocale.set('en'),true);
  assert.equal(document.documentElement.dir,'ltr');
  assert.equal(window.YNXFinanceLocale.set('unknown'),false);
  assert.equal(window.YNXFinanceLocale.get(),'en');
});
