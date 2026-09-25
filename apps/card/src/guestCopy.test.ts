import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import {locales} from "./i18n";
import inventory from "./guest-locales/audit-inventory.json";
import {guestResources,guestCopySourceInventory,guestInvariantText,guestInvariantTemplates,guestTemplate,guestText,isGuestCopyKey,type GuestTemplate} from "./guestCopy";

const placeholders=(value:string)=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
test("twelve explicit resources exactly cover every fixed key and template without inherited English",()=>{
  assert.equal(locales.length,12);
  assert.equal(guestCopySourceInventory.length,144);
  for(const locale of locales){
    const resource=guestResources[locale];
    for(const section of ["text","templates"] as const){
      assert.deepEqual(Object.keys(resource[section]).sort(),Object.keys(guestResources.en[section]).sort(),`${locale}.${section}`);
      for(const [key,value] of Object.entries(resource[section])){
        assert.ok(value.trim(),`${locale}.${key}`);
        assert.doesNotMatch(value,/[\u202A-\u202E\u2066-\u2069]/,`${locale}.${key}: hidden bidi control`);
        const baseline=(guestResources.en[section] as Record<string,string>)[key]!;
        assert.deepEqual(placeholders(value),placeholders(baseline),`${locale}.${key}: placeholders`);
        const invariant:readonly string[]=section==="text"?guestInvariantText:guestInvariantTemplates;
        if(invariant.includes(key))assert.equal(value,baseline,`${locale}.${key}: identity literal`);
        else if(locale!=="en")assert.notEqual(value,baseline,`${locale}.${key}: English fallback`);
      }
    }
  }
});

test("the original 147-item audit is accounted for, including replaced interpolation fragments",()=>{
  assert.equal(inventory.baselineEntries,147);
  for(const value of inventory.fixedValues)assert.ok(isGuestCopyKey(value)||Object.hasOwn(inventory.replacedOrNonText,value),value);
  for(const template of Object.values(inventory.dynamicCoverage))if(template!=="explicit guestText call")assert.ok(Object.hasOwn(guestResources.en.templates,template),template);
});

test("actual JSX fixed text and action labels are registered, including future additions",()=>{
  const filename=new URL("./GuestExperience.tsx",import.meta.url);const source=fs.readFileSync(filename,"utf8");
  const ast=ts.createSourceFile("GuestExperience.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const missing:string[]=[];
  function visit(node:ts.Node){
    if(ts.isJsxText(node)&&node.text.trim()&&!isGuestCopyKey(node.text.trim()))missing.push(node.text.trim());
    if(ts.isJsxAttribute(node)&&["label","detail","accessibilityLabel"].includes(node.name.getText(ast))&&node.initializer&&ts.isStringLiteral(node.initializer)&&!isGuestCopyKey(node.initializer.text))missing.push(node.initializer.text);
    ts.forEachChild(node,visit);
  }
  visit(ast);assert.deepEqual(missing,[]);
});

test("missing copy and incorrect template variables fail visibly instead of using English",()=>{
  assert.throws(()=>guestText("ar","__missing_copy__"),/Unknown Guest copy/);
  assert.throws(()=>guestText("ar","__proto__"),/Unknown Guest copy/);
  assert.throws(()=>guestTemplate("ar","approvedAccount",{account:"A"}),/Invalid Guest template/);
  assert.throws(()=>guestTemplate("ar","walletConnected",{address:"A",extra:"B"}),/Invalid Guest template/);
  for(const locale of locales)for(const key of Object.keys(guestResources.en.templates) as GuestTemplate[]){
    const values=Object.fromEntries(placeholders(guestResources.en.templates[key]).map(name=>[name!,`SYNTHETIC_${name}_$&`]));
    const output=guestTemplate(locale,key,values);for(const value of Object.values(values))assert.ok(output.includes(value),`${locale}.${key}`);
  }
});

test("funding, native identity, simulation and download keep separate truthful meanings",()=>{
  for(const locale of locales){
    assert.notEqual(guestText(locale,"Download YNX Wallet"),guestText(locale,"Connect YNX Wallet"));
    assert.notEqual(guestText(locale,"Private services are optional"),guestText(locale,"Private Service Degraded"));
    assert.match(guestText(locale,"Native identity does not authorize YNXT funding. A separate supported funding flow must verify every requirement."),/YNXT/);
    assert.match(guestText(locale,"No real funds, cards, merchants, settlement, PAN, CVV, or personal data."),/PAN/);
    assert.match(guestText(locale,"No real funds, cards, merchants, settlement, PAN, CVV, or personal data."),/CVV/);
  }
  assert.match(guestText("zh-CN","A wallet, exact YNXT Testnet funding intent, confirmed on-chain transaction, and Card API acceptance are all required before any balance can be shown."),/已确认.*Card API/);
  assert.match(guestText("zh-TW","These controls change only the local demo state. They cannot affect a real card."),/只改變.*不能影響真實卡/);
  assert.doesNotMatch(guestText("en","Private services are optional"),/CONNECTED|Degraded/);
});
