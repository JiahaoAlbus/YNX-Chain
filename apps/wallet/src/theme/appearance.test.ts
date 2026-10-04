import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {appearanceCopy,loadUISize,parseUISize,saveUISize,textSizeScale,UI_SIZE_KEY,UI_SIZES} from "./appearance";
import {SUPPORTED_LOCALES} from "../i18n/i18n";

test("strict appearance schema rejects malformed and expanded preferences",()=>{
  for(const raw of [null,"",'null','[]','{"version":2,"size":"larger"}','{"version":1,"size":"tiny"}','{"version":1,"size":"larger","account":"x"}'])assert.equal(parseUISize(raw),"standard");
  for(const size of UI_SIZES)assert.equal(parseUISize(JSON.stringify({version:1,size})),size);
});
test("display preference persists under its own key without touching custody",async()=>{
  const data=new Map<string,string>([["ynx.wallet.manifest.v2","unchanged"]]);
  const storage={getItem:async(key:string)=>data.get(key)??null,setItem:async(key:string,value:string)=>{assert.equal(key,UI_SIZE_KEY);data.set(key,value)},deleteItem:async()=>{throw Error("must not delete")}};
  assert.equal(await loadUISize(storage),"standard");await saveUISize(storage,"larger");assert.equal(await loadUISize(storage),"larger");assert.equal(data.get("ynx.wallet.manifest.v2"),"unchanged");
  await assert.rejects(saveUISize({...storage,setItem:async()=>{throw Error("unavailable")}},"compact"),/unavailable/);
});
test("all twelve locales have distinct size labels and retain additive OS scaling",async()=>{
  for(const locale of SUPPORTED_LOCALES){const copy=appearanceCopy(locale);assert.equal(new Set(UI_SIZES.map(size=>copy[size])).size,3);assert.ok(copy.title&&copy.hint)}
  assert.ok(textSizeScale("compact")<1);assert.equal(textSizeScale("standard"),1);assert.ok(textSizeScale("larger")>1);
  const app=await readFile(new URL("../../App.tsx",import.meta.url),"utf8");
  assert.match(app,/brandLogo:\{flexShrink:0,width:41\.8,height:22\}/);assert.match(app,/resizeMode="contain"/);
  assert.doesNotMatch(app,/allowFontScaling=\{false\}|maxFontSizeMultiplier/);
  assert.match(app,/iconButton:\{flexShrink:0,width:44,height:44/);
  assert.match(app,/<SafeAreaView edges=\{\["bottom","left","right"\]\} style=\{styles\.sheetFrame\}/);
});
test("actual Native style factory scales only text and retains wrap-ready 44dp controls",async()=>{
  const app=await readFile(new URL("../../App.tsx",import.meta.url),"utf8");
  const context:any={StyleSheet:{create:(rules:unknown)=>rules,hairlineWidth:1},ACTIVE_COLORS:{},Platform:{select:()=>"monospace"}};
  runInNewContext(ts.transpile(app.slice(app.indexOf("function createStyles("))+"\nglobalThis.stylesFactory=createStyles;",{target:ts.ScriptTarget.ES2022}),context);
  for(const size of UI_SIZES){const style=context.stylesFactory(textSizeScale(size));assert.equal(style.brandLogo.height,22);assert.equal(style.iconButton.width,44);assert.equal(style.iconButton.height,44);assert.equal(style.button.minHeight,50);assert.equal(style.buttonText.flexShrink,1);assert.equal(style.quick.minWidth,0);assert.equal(style.title.fontSize,22*textSizeScale(size));assert.equal(style.sheetText.lineHeight,21*textSizeScale(size));assert.equal(style.sheetHeader.flexShrink,0);assert.equal(style.screen.flexGrow,1)}
});
