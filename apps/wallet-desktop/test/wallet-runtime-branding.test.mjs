import test from "node:test";
import assert from "node:assert/strict";
import {configureWalletRuntimeBranding} from "../src/wallet-runtime-branding.mjs";
for(const packaged of [true,false])test(`runtime brand uses original icon and accurate ${packaged?"packaged":"QA"} identity`,()=>{
  const calls={},icon={isEmpty:()=>false},app={isPackaged:packaged,getVersion:()=>"0.6.8",getAppPath:()=>"/tmp/locale-source/apps/wallet-desktop",setName:value=>calls.name=value,setAboutPanelOptions:value=>calls.about=value,dock:{setIcon:value=>calls.icon=value}};
  const Menu={buildFromTemplate:value=>value,setApplicationMenu:value=>calls.menu=value},nativeImage={createFromPath:value=>{calls.path=value;return icon}};
  const branding=configureWalletRuntimeBranding({app,Menu,nativeImage,directory:"/tmp/locale-source/apps/wallet-desktop/src"});
  assert.equal(calls.name,"YNX Wallet");assert.equal(calls.icon,icon);assert.match(calls.path,/src\/icon.png$/);assert.equal(calls.menu[0].label,"YNX Wallet");assert.equal(calls.about.applicationVersion,"0.6.8");
  assert.equal(branding.title,packaged?"YNX Wallet":"YNX Wallet · QA");assert.equal(calls.about.copyright.includes("Not an official release"),!packaged);if(!packaged)assert.match(calls.about.copyright,/Source: locale-source/);
});
