import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import {catalogs,locales,localeNames,type Locale} from "./i18n";
const require=createRequire(import.meta.url),{mountLanguage,textOf}=require("../test/guest-experience-fixture.cjs");
const controls:Record<Locale,readonly[string,string,string]>={en:["Language","Done","Refresh"],"zh-CN":["语言","完成","刷新"],"zh-TW":["語言","完成","重新整理"],ja:["言語","完了","更新"],ko:["언어","완료","새로고침"],es:["Idioma","Listo","Actualizar"],fr:["Langue","Terminé","Actualiser"],de:["Sprache","Fertig","Aktualisieren"],pt:["Idioma","Concluído","Atualizar"],ru:["Язык","Готово","Обновить"],ar:["اللغة","تم","تحديث"],id:["Bahasa","Selesai","Segarkan"]};
const shellKeys=["app","sandbox","settings","done","retry","refresh","overview","activity","controls","simulation","support"] as const;

test("each locale declares the scoped shell copy explicitly, with only valid brands and same-spelling words shared",()=>{
  const source=ts.createSourceFile("i18n.ts",readFileSync(new URL("./i18n.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
  const own=new Map<string,Set<string>>();
  for(const statement of source.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&declaration.initializer&&ts.isObjectLiteralExpression(declaration.initializer))own.set(declaration.name.text,new Set(declaration.initializer.properties.filter(ts.isPropertyAssignment).map(property=>property.name.getText(source))));
  for(const locale of locales){
    const name=locale==="zh-CN"?"zhCN":locale==="zh-TW"?"zhTW":locale;
    for(const key of shellKeys){assert.ok(own.get(name)?.has(key),`${locale}.${key} must not silently inherit another language`);assert.ok(catalogs[locale][key].trim());
      if(locale!=="en"&&catalogs[locale][key]===catalogs.en[key])assert.ok(key==="app"||key==="simulation"&&["fr","de"].includes(locale)||key==="support"&&locale==="de",`${locale}.${key} unexpectedly copies English`);
    }
    assert.deepEqual([catalogs[locale].settings,catalogs[locale].done,catalogs[locale].refresh],controls[locale]);
  }
  assert.equal(catalogs["zh-TW"].simulation,"模擬");assert.equal(catalogs.pt.activity,"Atividade");assert.equal(catalogs.de.activity,"Aktivität");
});

for(const locale of locales)test(`${locale}: actual Language page exposes localized title, Done action and all twelve named radio choices`,async t=>{
  const app=await mountLanguage(locale);t.after(()=>app.unmount());
  const title=app.renderer.root.findAll((node:any)=>node.type==="Text").map(textOf);assert.ok(title.includes(controls[locale][0]));
  const done=app.renderer.root.find((node:any)=>node.type==="Pressable"&&node.props.accessibilityRole==="button");assert.equal(done.props.accessibilityLabel,controls[locale][1]);assert.equal(textOf(done),controls[locale][1]);
  const radios=app.renderer.root.findAll((node:any)=>node.type==="Pressable"&&node.props.accessibilityRole==="radio");assert.equal(radios.length,12);
  for(const [index,radio] of radios.entries()){assert.equal(radio.props.accessibilityLabel,localeNames[locales[index]]);assert.equal(radio.props.accessibilityState.checked,locales[index]===locale);}
  await app.press(done);assert.equal(app.closes,1);
});

test("actual language selection updates the page title, Done name and checked radio together",async t=>{
  const app=await mountLanguage("en");t.after(()=>app.unmount());
  for(const locale of ["zh-CN","ar","en"] as const){
    const radio=app.renderer.root.find((node:any)=>node.type==="Pressable"&&node.props.accessibilityLabel===localeNames[locale]);await app.press(radio);
    const done=app.renderer.root.find((node:any)=>node.type==="Pressable"&&node.props.accessibilityRole==="button");assert.equal(done.props.accessibilityLabel,controls[locale][1]);
    assert.ok(app.renderer.root.findAll((node:any)=>node.type==="Text").map(textOf).includes(controls[locale][0]));
    const checked=app.renderer.root.findAll((node:any)=>node.type==="Pressable"&&node.props.accessibilityState?.checked);assert.equal(checked.length,1);assert.equal(checked[0].props.accessibilityLabel,localeNames[locale]);
  }
});
