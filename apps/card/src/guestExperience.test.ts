import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {locales} from "./i18n";
import {guestText,guestResources,guestInvariantText} from "./guestCopy";
import {registrationResources} from "./registrationCopy";
const require=createRequire(import.meta.url);
const {mountGuest,flattenStyle,textOf}=require("../test/guest-experience-fixture.cjs");
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
function registeredVisibleText(locale:typeof locales[number],value:string){
  const literals=[...Object.values(guestResources[locale].text),...Object.values(registrationResources[locale].text),...Object.values(registrationResources[locale].statuses)];
  const templates=[...Object.values(guestResources[locale].templates),...Object.values(registrationResources[locale].templates)];
  return ["1","2","3","4","5"].includes(value)||literals.includes(value)||templates.some(template=>new RegExp("^"+template.split(/\{\w+\}/).map(escape).join(".+")+"$").test(value));
}

for(const platform of ["android","ios"])test(`${platform}: every guest connection entry calls only native YNX authorization`,async t=>{
  const app=await mountGuest({platform,props:{standardWalletState:{status:"disconnected",chooserOpen:true}}});t.after(()=>app.unmount());
  assert.doesNotMatch(app.text(),/MetaMask|Choose a wallet|Independent YNX EIP-1193 provider/);
  const buttons=app.buttons("Connect YNX Wallet");assert.equal(buttons.length,3);
  for(const button of buttons)await app.press(button);
  assert.equal(app.calls.native,3);assert.equal(app.calls.chooser,0);assert.equal(app.calls.metamask,0);
  await app.tab("Top up with YNXT");assert.match(app.text(),/Native identity does not authorize YNXT funding/);
  const prepare=app.buttons("Connect YNX Wallet to prepare");assert.equal(prepare.length,1);await app.press(prepare[0]);
  assert.equal(app.calls.native,4);assert.equal(app.calls.chooser,0);assert.equal(app.calls.metamask,0);
  await app.tab("Security & Help");assert.doesNotMatch(app.text(),/MetaMask|Only when you intentionally need a Standard EVM/);
});

test("web keeps its separate standard-wallet chooser and explicit MetaMask action",async t=>{
  const app=await mountGuest({platform:"web",props:{standardWalletState:{status:"disconnected",chooserOpen:true}}});t.after(()=>app.unmount());
  assert.match(app.text(),/MetaMask EIP-1193 provider/);
  await app.press(app.buttons("Use MetaMask")[0]);assert.equal(app.calls.metamask,1);assert.equal(app.calls.native,0);
  await app.press(app.buttons("Choose a wallet")[0]);assert.equal(app.calls.chooser,1);
});

for(const locale of locales)test(`${locale}: all six native sections render localized fixed text and local demo notices`,async t=>{
  const app=await mountGuest({locale});t.after(()=>app.unmount());
  const sections=["Overview","Virtual Card","Top up with YNXT","Activity","Spending Controls","Security & Help"];
  for(const section of sections){
    await app.tab(guestText(locale,section));
    assert.ok(app.renderer.root.findAll((node:any)=>node.type==="Pressable"&&node.props.accessibilityRole==="tab").length===6);
    for(const node of app.renderer.root.findAll((node:any)=>node.type==="Text")){
      const value=textOf(node).trim();assert.ok(registeredVisibleText(locale,value),`${locale}/${section}: unregistered visible text ${value}`);if(locale!=="en"&&Object.hasOwn(guestResources.en.text,value)&&!(guestInvariantText as readonly string[]).includes(value))assert.fail(`${locale}/${section}: untranslated ${value}`);
      assert.notEqual(node.props.allowFontScaling,false);assert.equal(node.props.maxFontSizeMultiplier,undefined);assert.equal(node.props.numberOfLines,undefined);
    }
  }
  await app.tab(guestText(locale,"Virtual Card"));await app.press(app.buttons(guestText(locale,"Simulate authorization"))[0]);
  assert.match(app.text(),new RegExp(guestText(locale,"Authorization decision prepared locally").replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.equal(app.calls.native,0);assert.equal(app.calls.metamask,0);assert.equal(app.calls.chooser,0);assert.equal(app.calls.reads,0);assert.equal(app.calls.writes,0);
  assert.ok(app.calls.scroll.every((call:any)=>call.y===0));
});

test("Arabic compact header retains column layout without limiting text scaling",async t=>{
  const compact=await mountGuest({locale:"ar",width:412});t.after(()=>compact.unmount());
  const header=compact.renderer.root.findAll((n:any)=>n.type==="View"&&flattenStyle(n.props.style).minHeight===74)[0];
  assert.equal(flattenStyle(header.props.style).flexDirection,"column");
  const wide=await mountGuest({locale:"ar",width:1000});t.after(()=>wide.unmount());
  const wideHeader=wide.renderer.root.findAll((n:any)=>n.type==="View"&&flattenStyle(n.props.style).minHeight===74)[0];assert.equal(flattenStyle(wideHeader.props.style).flexDirection,"row-reverse");
});
