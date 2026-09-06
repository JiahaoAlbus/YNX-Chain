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
