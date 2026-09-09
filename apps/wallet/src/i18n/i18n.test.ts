import assert from "node:assert/strict";import{test}from"node:test";
import{allMessages,detectLocale,formatDateTime,formatYNXT,isRTL,loadLocale,localizeError,localizeProductSessionError,LOCALE_PREFERENCE_KEY,plural,saveLocale,SUPPORTED_LOCALES,translate}from"./i18n";
import type{SecureStorageAdapter}from"../storage/walletRepository";
import{readFileSync}from"node:fs";
import{walletCopy}from"./i18n";
import{WalletSecretRecoveryRequired}from"../storage/walletRepository";
import{needsOfflineKeyRecovery}from"../state/recoveryReview";
class MemoryStorage implements SecureStorageAdapter{values=new Map<string,string>();async getItem(k:string){return this.values.get(k)??null}async setItem(k:string,v:string){this.values.set(k,v)}async deleteItem(k:string){this.values.delete(k)}}
test("all twelve locales contain every nonblank security and accessibility key",()=>{const messages=allMessages(),keys=Object.keys(messages.en);assert.equal(SUPPORTED_LOCALES.length,12);for(const locale of SUPPORTED_LOCALES){assert.deepEqual(Object.keys(messages[locale]).sort(),[...keys].sort());for(const key of keys)assert.ok((messages[locale] as any)[key].trim().length>0,`${locale}.${key}`)}});
test("system detection, manual selection, restart persistence, and Arabic RTL are deterministic",async()=>{const storage=new MemoryStorage();assert.equal(await loadLocale(storage,"zh-TW"),"zh-Hant");await saveLocale(storage,"ar");assert.equal(storage.values.get(LOCALE_PREFERENCE_KEY),"ar");assert.equal(await loadLocale(storage,"en-US"),"ar");assert.equal(isRTL("ar"),true);assert.equal(isRTL("en"),false);assert.equal(detectLocale("id-ID"),"id")});
test("dates, numbers, YNXT amounts, plurals, errors and long labels remain nonblank",()=>{for(const locale of SUPPORTED_LOCALES){assert.ok(formatDateTime(locale,"2026-07-15T12:00:00.000Z").length>3);assert.match(formatYNXT(locale,1234.5),/YNXT$/);assert.ok(plural(locale,2,{one:"one",other:"other"}));assert.match(localizeError(locale,new Error("detail")),/detail/);assert.ok(translate(locale,"settingsTitle").length<80)}});

const androidUserCancel=new Error("Call to function 'ExpoSecureStore.getValueWithKeyAsync' has been rejected.\n→ Caused by: Could not Authenticate the user: User canceled the authentication. Fingerprint operation canceled by user");
test("actual Android user cancellation gives a localized original-request retry message without native diagnostics",()=>{
  const results=new Set<string>();
  for(const locale of SUPPORTED_LOCALES){
    const text=localizeProductSessionError(locale,androidUserCancel,"approve",false);
    assert.ok(text.length>10);assert.ok(text.includes(translate(locale,"approve")),locale);
    assert.doesNotMatch(text,/ExpoSecureStore|getValueWithKeyAsync|Caused by|Security check failed/);
    assert.equal(needsOfflineKeyRecovery(text),false);results.add(text);
  }
  assert.equal(results.size,12);
  assert.match(localizeProductSessionError("zh-Hans",androidUserCancel,"approve",false),/已取消身份验证/);
  assert.match(localizeProductSessionError("ar",androidUserCancel,"approve",false),/تم إلغاء/);
});

test("pinned iOS user cancellation and explicit legacy authentication cancellation share the safe presentation",()=>{
  const expected=localizeProductSessionError("en",androidUserCancel,"approve",false);
  for(const error of [new Error("Calling the 'getValueWithKeyAsync' function has failed\n→ Caused by: User canceled the operation."),new Error("Calling the 'setValueWithKeyAsync' function has failed\n→ Caused by: User canceled the operation."),new Error("Biometric authorization was cancelled"),new Error(androidUserCancel.message.replace("getValueWithKeyAsync","setValueWithKeyAsync"))]){
    assert.equal(localizeProductSessionError("en",error,"approve",false),expected);
  }
});

test("non-user failures, generic cancellation, expiry and consumption errors keep their distinct failure path",()=>{
  for(const error of [new Error(androidUserCancel.message.replace("User canceled the authentication","Lockout")),new Error("User canceled the operation."),new Error("Wallet operation expired or was cancelled. Review and authorize again."),new Error("Wallet request was already consumed; start a new product connection request"),new Error("Wallet replay consumption could not be verified"),new Error("Biometric authorization failed"),new WalletSecretRecoveryRequired()]){
    const text=localizeProductSessionError("zh-Hans",error,"approve",false);
    assert.equal(text,localizeError("zh-Hans",error));
    assert.equal(needsOfflineKeyRecovery(text),error instanceof WalletSecretRecoveryRequired);
  }
});

test("a signed return or non-approval action never suggests approving again",()=>{
  for(const action of ["approve","reject","retryReturn"] as const){
    assert.equal(localizeProductSessionError("en",androidUserCancel,action,true),localizeError("en",androidUserCancel));
    if(action!=="approve")assert.equal(localizeProductSessionError("en",androidUserCancel,action,false),localizeError("en",androidUserCancel));
  }
});

test("Connected Apps renders the exact device logout reason distinctly from permanent device revocation",()=>{
  const source=readFileSync(new URL("../../App.tsx",import.meta.url),"utf8");
  const typed=source.split("\n").find(line=>line.startsWith("function sessionReason("));
  assert.ok(typed,"Actual Connected Apps status formatter must remain connected");
  const js=typed.replace("locale:WalletLocale,reason:string","locale,reason").replace(" as Record<string,string>","");
  const render=new Function("walletCopy",`${js};return sessionReason`)(walletCopy) as (locale:typeof SUPPORTED_LOCALES[number],reason:string)=>string;
  for(const [locale,expected] of [["en","Device sessions signed out"],["zh-Hans","设备会话已退出"],["ar","تم تسجيل الخروج من جلسات الجهاز"]] as const){
    assert.equal(render(locale,"device-logout"),expected);
    assert.equal(render(locale,"device-revoked"),walletCopy(locale,"Device revoked"));
    assert.notEqual(render(locale,"device-logout"),render(locale,"device-revoked"));
  }
  for(const locale of SUPPORTED_LOCALES)assert.notEqual(render(locale,"device-logout"),"device-logout");
});

const faucetDetailCopy = [
  "Test YNXT",
  "Test YNXT requests are not available in this version.",
  "View saved request",
  "Reading saved request…",
  "Saved request unavailable. Sending is paused.",
  "Review test YNXT request",
  "Recipient account",
  "Requested amount",
  "Not sent",
  "Submit this request",
  "Sending this request…",
  "Result not confirmed",
  "This request may already have been processed. Keep its original ID and amount.",
  "Review and retry original request",
  "Too many requests. Retry the original request manually later.",
  "Request received",
  "The request was received. Your balance has not been verified.",
  "Check block receipt",
  "Saved receipt copy — check again",
  "The node saved the pending request. No block receipt has been verified yet.",
  "Block receipt checked",
  "The node's local snapshot covers this transaction. Balance and consensus finality have not been verified.",
  "Confirm receipt reviewed",
  "Close and keep request",
  "The original request does not match the service record. Keep it for review.",
  "The service cannot verify the original receipt yet. Keep this request.",
  "Request ID",
  "Transaction hash",
  "Request nonce",
  "Block number",
  "Block hash",
  "Snapshot block number",
  "Snapshot block hash",
  "Snapshot integrity",
  "RPC origin",
  "Receipt details",
  "No saved request",
  "Request amount will be shown when this service becomes available.",
  "Receipt review saved.",
  "This is a testnet request. Test YNXT has no monetary value.",
  "No block receipt has been verified yet.",
  "This request is still pending verification.",
  "Network",
  "Network fee",
  "Close and reopen this request to continue.",
  "The request could not be checked. Keep the original request and try again manually.",
  "Preparing request…",
  "Checking block receipt…",
  "Saving receipt review…",
] as const;

test("every Faucet flow message and receipt label has explicit Chinese and Arabic copy",()=>{
  assert.equal(faucetDetailCopy.length,49);
  for(const key of faucetDetailCopy){
    assert.equal(walletCopy("en",key),key);
    for(const locale of ["zh-Hans","ar"] as const){
      const text=walletCopy(locale,key);
      assert.notEqual(text,key,`${locale}: ${key} must not fall back to English`);
      assert.match(text,locale==="ar"?/\p{Script=Arabic}/u:/\p{Script=Han}/u);
      assert.doesNotMatch(text,/[\u202a-\u202e\u2066-\u2069]/u);
      if(key.includes("YNXT"))assert.ok(text.includes("YNXT"),`${locale}: preserve the asset identifier`);
    }
  }
});

test("Faucet unsent, unknown, received, checked and review-saved states stay distinct",()=>{
  const states=["Not sent","Result not confirmed","Request received","Block receipt checked","Receipt review saved.","No saved request","Saved request unavailable. Sending is paused.","Preparing request…","Checking block receipt…","Saving receipt review…"] as const;
  for(const locale of ["en","zh-Hans","ar"] as const){
    assert.equal(new Set(states.map(key=>walletCopy(locale,key))).size,states.length);
  }
  assert.match(walletCopy("zh-Hans","Receipt review saved."),/查看记录/);
  assert.match(walletCopy("ar","Receipt review saved."),/سجل مراجعة/);
});

test("Faucet availability and receipt copy retain the unknown amount and limited truth claims",()=>{
  const amount="Request amount will be shown when this service becomes available.";
  for(const locale of ["en","zh-Hans","ar"] as const){
    assert.doesNotMatch(walletCopy(locale,amount),/[0-9\u0660-\u0669\u06f0-\u06f9]/u);
    assert.notEqual(walletCopy(locale,"No block receipt has been verified yet."),walletCopy(locale,"Block receipt checked"));
  }
  assert.match(walletCopy("zh-Hans","The request was received. Your balance has not been verified."),/余额尚未核对/);
  assert.match(walletCopy("ar","The request was received. Your balance has not been verified."),/لم يتم التحقق من رصيدك/);
  assert.match(walletCopy("zh-Hans","The node's local snapshot covers this transaction. Balance and consensus finality have not been verified."),/余额和共识最终性尚未核验/);
  assert.match(walletCopy("ar","The node's local snapshot covers this transaction. Balance and consensus finality have not been verified."),/لم يُتحقق من الرصيد أو نهائية الإجماع/);
  assert.match(walletCopy("zh-Hans","This is a testnet request. Test YNXT has no monetary value."),/没有货币价值/);
  assert.match(walletCopy("ar","This is a testnet request. Test YNXT has no monetary value."),/لا توجد قيمة مالية/);
});
