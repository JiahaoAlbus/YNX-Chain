import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {locales} from "./i18n";
import {guestText,guestResources,guestInvariantText} from "./guestCopy";
import {registrationResources} from "./registrationCopy";
import {registrationText} from "./registrationCopy";
import {createDraft} from "./registration";
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
  await app.layoutSection(900);
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
  assert.ok(app.calls.scroll.length>=8);assert.ok(app.calls.scroll.every((call:any)=>call.y===900));
});

test("Arabic compact header retains column layout without limiting text scaling",async t=>{
  const compact=await mountGuest({locale:"ar",width:412});t.after(()=>compact.unmount());
  const header=compact.renderer.root.findAll((n:any)=>n.type==="View"&&flattenStyle(n.props.style).minHeight===74)[0];
  assert.equal(flattenStyle(header.props.style).flexDirection,"column");
  const wide=await mountGuest({locale:"ar",width:1000});t.after(()=>wide.unmount());
  const wideHeader=wide.renderer.root.findAll((n:any)=>n.type==="View"&&flattenStyle(n.props.style).minHeight===74)[0];assert.equal(flattenStyle(wideHeader.props.style).flexDirection,"row-reverse");
});

test("compact Arabic shares one scroll viewport for chrome, six tabs, safety boundary and real content",async t=>{
  const app=await mountGuest({locale:"ar",width:412,fontScale:2});t.after(()=>app.unmount());
  const scrolls=app.renderer.root.findAll((node:any)=>node.type==="ScrollView");assert.equal(scrolls.length,1);
  const viewport=scrolls[0];
  assert.equal(viewport.findAll((node:any)=>node.type==="Pressable"&&node.props.accessibilityRole==="tab").length,6);
  const text=textOf(viewport);
  for(const key of ["Explore as guest","TESTNET SANDBOX","No real funds, cards, merchants, settlement, PAN, CVV, or personal data.","Understand card flows before they touch the real world."])assert.ok(text.includes(guestText("ar",key)),key);
  assert.equal(viewport.findAll((node:any)=>node.props.testID==="guest-section-content").length,1);
  assert.equal(viewport.findAll((node:any)=>node.type==="ScrollView").length,1);
});

test("compact navigation measures current content then returns to the section start, including Help and repeated tabs",async t=>{
  const app=await mountGuest({locale:"ar",width:412,fontScale:2,layoutOptions:{ready:false}});t.after(()=>app.unmount());
  await app.tab(guestText("ar","Top up with YNXT"));assert.equal(app.calls.scroll.length,0,"No unmeasured navigation to the tall header");
  await app.layoutSection(820);assert.equal(app.calls.scroll.at(-1).y,820);
  await app.press(app.buttons(guestText("ar","Read safety requirements"))[0]);assert.equal(app.calls.scroll.at(-1).y,820);
  assert.ok(app.text().includes(guestText("ar","YNX Card is currently a Testnet simulation environment for learning and product evaluation.")));
  await app.tab(guestText("ar","Overview"));assert.equal(app.calls.scroll.at(-1).y,820);
  const count=app.calls.scroll.length;await app.tab(guestText("ar","Overview"));assert.equal(app.calls.scroll.length,count+1);assert.equal(app.calls.scroll.at(-1).y,820);
  app.setMeasurement({y:510});await app.resize({fontScale:1.3});const before=app.calls.scroll.length;await app.tab(guestText("ar","Virtual Card"));assert.equal(app.calls.scroll.length,before+1);
  assert.equal(app.calls.scroll.at(-1).y,510,"Fresh host measurement replaces the old large-font offset even without onLayout");
  assert.equal(app.calls.native,0);assert.equal(app.calls.metamask,0);assert.equal(app.calls.chooser,0);assert.equal(app.calls.reads,0);assert.equal(app.calls.writes,0);
});

test("locale change with no onLayout still navigates using a fresh synchronous host measurement",async t=>{
  const app=await mountGuest({width:412,fontScale:2});t.after(()=>app.unmount());await app.layoutSection(820);await app.tab("Top up with YNXT");
  await app.update({locale:"zh-CN"});await app.tab(guestText("zh-CN","Virtual Card"));assert.equal(app.calls.scroll.length,2);assert.equal(app.calls.scroll.at(-1).y,820);
  app.setMeasurement({y:960});await app.update({locale:"ar"});await app.tab(guestText("ar","Security & Help"));assert.equal(app.calls.scroll.at(-1).y,960);
  assert.ok(app.calls.measure.every((call:any)=>call.parentMatches));assert.equal(app.calls.reads,0);assert.equal(app.calls.writes,0);
});

test("late measurement callbacks cannot override newer locale, navigation or onLayout requests",async t=>{
  const app=await mountGuest({layoutOptions:{defer:true,y:820}});t.after(()=>app.unmount());await app.tab("Top up with YNXT");
  app.setMeasurement({y:940});await app.update({locale:"zh-CN"});await app.tab(guestText("zh-CN","Virtual Card"));
  const latest=app.calls.measure.length-1;for(let i=0;i<latest;i++)await app.resolveMeasurement(i);assert.equal(app.calls.scroll.length,0);
  await app.resolveMeasurement(latest);assert.equal(app.calls.scroll.at(-1).y,940);
  await app.tab(guestText("zh-CN","Security & Help"));const old=app.calls.measure.length-1;await app.layoutSection(1020);const current=app.calls.measure.length-1;
  const before=app.calls.scroll.length;await app.resolveMeasurement(old);assert.equal(app.calls.scroll.length,before);await app.resolveMeasurement(current);assert.equal(app.calls.scroll.at(-1).y,1020);
});

for(const mode of ["silent","throwMeasure","fail"] as const)test(`${mode}: missing or failed measure callbacks never block a fresh tab request`,async t=>{
  const app=await mountGuest({layoutOptions:{y:600,silent:mode==="silent",throwMeasure:mode==="throwMeasure",ready:mode!=="fail"}});t.after(()=>app.unmount());
  await app.tab("Top up with YNXT");assert.equal(app.calls.scroll.length,0);
  app.setMeasurement({y:650,silent:false,throwMeasure:false,ready:true});await app.tab("Virtual Card");assert.equal(app.calls.scroll.at(-1).y,650);
});

test("invalid measured positions and late callbacks after unmount never scroll",async()=>{
  const app=await mountGuest();
  for(const y of [NaN,Infinity,-1]){app.setMeasurement({y});await app.tab("Virtual Card");assert.equal(app.calls.scroll.length,0);}
  app.setMeasurement({defer:true,y:600});await app.tab("Security & Help");await app.unmount();await app.resolveMeasurement(0);assert.equal(app.calls.scroll.length,0);
});

test("desktop keeps chrome outside its content viewport and navigation starts at content zero",async t=>{
  const app=await mountGuest({platform:"web",width:1100});t.after(()=>app.unmount());
  const viewport=app.renderer.root.find((node:any)=>node.type==="ScrollView");
  assert.equal(viewport.findAll((node:any)=>node.type==="Pressable"&&node.props.accessibilityRole==="tab").length,0);
  assert.ok(!textOf(viewport).includes(guestText("en","No real funds, cards, merchants, settlement, PAN, CVV, or personal data.")));
  await app.tab("Security & Help");assert.equal(app.calls.scroll.at(-1).y,0);
});

test("crossing the compact breakpoint preserves the current owner's unsaved registration form",async t=>{
  const wallet={address:"0x1111111111111111111111111111111111111111",chainId:6423};
  const app=await mountGuest({platform:"web",width:1000,props:{walletSession:wallet},storageOptions:{record:createDraft(wallet.address)}});t.after(()=>app.unmount());
  await app.change(registrationText("en","nickname"),"Unsubmitted responsive draft");
  const readCount=app.calls.reads;
  for(const width of [412,1000,412]){
    await app.resize({width});const input=app.renderer.root.find((node:any)=>node.type==="TextInput"&&node.props.accessibilityLabel===registrationText("en","nickname"));
    assert.equal(input.props.value,"Unsubmitted responsive draft");assert.equal(app.calls.reads,readCount);assert.equal(app.calls.writes,0);
  }
});
