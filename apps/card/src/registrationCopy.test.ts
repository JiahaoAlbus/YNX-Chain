import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import{locales}from"./i18n";
import{registrationResources,registrationErrorKey,registrationStatus,registrationTemplate,registrationText,type RegistrationCopyKey,type RegistrationTemplate}from"./registrationCopy";
import type{RegistrationStatus}from"./registration";
const placeholders=(value:string)=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
test("registration has 12 explicit complete resources, 32 text keys, 7 statuses and 2 templates",()=>{
  assert.equal(Object.keys(registrationResources.en.text).length,32);assert.equal(Object.keys(registrationResources.en.statuses).length,7);assert.equal(Object.keys(registrationResources.en.templates).length,2);
  for(const locale of locales)for(const section of ["text","statuses","templates"] as const){
    assert.deepEqual(Object.keys(registrationResources[locale][section]).sort(),Object.keys(registrationResources.en[section]).sort());
    for(const [key,value]of Object.entries(registrationResources[locale][section])){
      const baseline=(registrationResources.en[section] as Record<string,string>)[key]!;
      assert.ok(value.trim());assert.doesNotMatch(value,/[\u202A-\u202E\u2066-\u2069]/);
      assert.deepEqual(placeholders(value),placeholders(baseline),`${locale}/${key}`);
      if(locale!=="en")assert.notEqual(value,baseline,`${locale}/${key}: English fallback`);
    }
  }
});
test("Registration JSX cannot add unregistered fixed text, placeholders or accessibility labels",()=>{
  const source=fs.readFileSync(new URL("./RegistrationExperience.tsx",import.meta.url),"utf8"),ast=ts.createSourceFile("RegistrationExperience.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const missing:string[]=[];
  function visit(node:ts.Node){
    if(ts.isJsxText(node)&&node.text.trim())missing.push(node.text.trim());
    if(ts.isJsxAttribute(node)&&["placeholder","accessibilityLabel"].includes(node.name.getText(ast))&&node.initializer&&ts.isStringLiteral(node.initializer))missing.push(node.initializer.text);
    if(ts.isCallExpression(node)&&node.expression.getText(ast)==="copy"&&ts.isStringLiteral(node.arguments[0]!))assert.ok(Object.hasOwn(registrationResources.en.text,(node.arguments[0] as ts.StringLiteral).text));
    ts.forEachChild(node,visit);
  }visit(ast);assert.deepEqual(missing,[]);
});
test("registration errors and statuses retain specific meanings and unknown errors stay private",()=>{
  const cases={"A Standard EVM wallet is required":"standardRequired","Only DRAFT applications are editable":"draftOnly","Complete nickname, use case, and a valid YNXT limit":"completeDetails","Testnet terms and application details must be accepted first":"acceptDetails","Application is not awaiting approval":"notAwaiting","ACTIVE applications cannot be cancelled here":"activeCannotCancel"};
  for(const [message,key]of Object.entries(cases))assert.equal(registrationErrorKey(new Error(message),"invalidApplication"),key);
  assert.equal(registrationErrorKey(new Error("UNTRUSTED secret English error"),"cannotSubmit"),"cannotSubmit");assert.equal(registrationErrorKey({message:"__proto__"},"cannotCancel"),"cannotCancel");
  for(const locale of locales){
    for(const status of Object.keys(registrationResources.en.statuses) as RegistrationStatus[])assert.ok(registrationTemplate(locale,"status",{status:registrationStatus(locale,status)}).includes(registrationStatus(locale,status)));
    for(const key of Object.keys(registrationResources.en.templates) as RegistrationTemplate[]){const values=Object.fromEntries(placeholders(registrationResources.en.templates[key]).map(name=>[name!,"SYNTHETIC_$&"]));assert.ok(registrationTemplate(locale,key,values).includes("SYNTHETIC_$&"))}
    assert.match(registrationText(locale,"nativeAuthority"),/YNX Wallet/);assert.match(registrationText(locale,"disclaimer"),/PAN.*CVV/);assert.match(registrationText(locale,"completeDetails"),/YNXT/);
  }
  assert.throws(()=>registrationText("en","__proto__" as RegistrationCopyKey));assert.throws(()=>registrationTemplate("en","audit",{}));assert.throws(()=>registrationTemplate("en","audit",{count:"1",extra:"2"}));
});
