import assert from "node:assert/strict";
import test from "node:test";
import {SUPPORTED_LOCALES,type WalletLocale} from "./i18n";
import {networkRecoveryCopy} from "./networkRecoveryCopy";
import {NativeDurabilityInvalid} from "../chain/nativeDurability";
import {NativeReadCancelled} from "../chain/nativeTransfer";

const interruption="The network connection was interrupted. Please refresh again.";
const timeout="The network request timed out. Please refresh again.";
const failed="The network is unavailable. Please refresh again.";
const receipt=new NativeDurabilityInvalid().message;

test("all 12 advertised locales provide four distinct translated error categories",()=>{
  assert.equal(SUPPORTED_LOCALES.length,12);
  for(const message of [interruption,timeout,failed,receipt]){
    const outputs=SUPPORTED_LOCALES.map(locale=>networkRecoveryCopy(locale,message));
    assert.equal(new Set(outputs).size,12);
    for(const text of outputs){assert.ok(text.length>8);assert.doesNotMatch(text,/\{status\}|[\u202a-\u202e\u2066-\u2069]/u)}
  }
  for(const locale of SUPPORTED_LOCALES)assert.equal(new Set([interruption,timeout,failed,receipt].map(text=>networkRecoveryCopy(locale,text))).size,4);
});

test("all read HTTP variants preserve the exact status in every locale",()=>{
  for(const locale of SUPPORTED_LOCALES)for(const status of [200,403,404,429,500,503,504])for(const message of [
    `The YNX node is temporarily unavailable (${status}). Please refresh again.`,
    `The YNX node could not complete this read (${status}). Please refresh again.`,
    `YNX chain returned non-JSON (${status})`,
  ]){const translated=networkRecoveryCopy(locale,message);assert.notEqual(translated,message);assert.equal(translated.match(/HTTP [0-9]{3}/g)?.join(),`HTTP ${status}`);assert.doesNotMatch(translated,/\{status\}/)}
});

test("known fixed response validation messages are localized without exposing data",()=>{
  for(const message of ["YNX chain response origin changed","YNX chain response exceeds the supported size","Authoritative account response is invalid","Authoritative account identity does not match the selected ynx1 account","Authoritative activity response is invalid","Authoritative activity entry is invalid"]){
    for(const locale of SUPPORTED_LOCALES)assert.equal(networkRecoveryCopy(locale,message),networkRecoveryCopy(locale,failed));
  }
});

test("actual durability error keeps the original transfer and never asks for a new signed request",()=>{
  assert.match(networkRecoveryCopy("en",receipt),/could not be verified.*original transfer remains saved/);
  assert.equal(networkRecoveryCopy("zh-Hans",receipt),"无法核验节点回执。原始转账仍已保存。");
  assert.equal(networkRecoveryCopy("zh-Hant",receipt),"無法驗證節點回執。原始轉帳仍已儲存。");
  assert.match(networkRecoveryCopy("ar",receipt),/التحويل الأصلي محفوظة/);
  assert.match(networkRecoveryCopy("id",receipt),/Transfer asli tetap tersimpan/);
});

test("unknown and near-match text remains byte-for-byte unchanged; cancellation is not a node error",()=>{
  const samples=["",new NativeReadCancelled().message,"a new diagnostic",interruption+" extra",`prefix: ${timeout}`,` ${receipt}`,"The YNX node is temporarily unavailable (999). Please refresh again.","The YNX node is temporarily unavailable (503;secret). Please refresh again.","YNX chain returned non-JSON (503)\nextra","FETCH FAILED OKHTTP3.INTERNAL.HTTP2.STREAMRESETEXCEPTION: STREAM WAS RESET CANCEL","The transfer has been sent."];
  for(const locale of SUPPORTED_LOCALES)for(const text of samples)assert.equal(networkRecoveryCopy(locale,text),text);
  assert.equal(networkRecoveryCopy("unsupported" as WalletLocale,interruption),interruption);
});
