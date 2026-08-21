import assert from "node:assert/strict";
import test from "node:test";
import {CONNECTED_DAPP_KEY, connectedDappRecord, forgetConnectedDapp, providerChooserState, readConnectedDapp, rememberConnectedDapp} from "../src/connected-dapps.js";

const ACCOUNT = `0x${"1".repeat(40)}`;
function storage() { const values = new Map(); return {getItem:(key)=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:(key)=>values.delete(key)}; }

test("Connected DApps records only an exact current HTTPS origin and live Testnet account shape", () => {
  assert.deepEqual(connectedDappRecord({origin:"https://wallet.ynxweb4.com",account:ACCOUNT,chainId:"0x1917",wallet:"metamask"}), {origin:"https://wallet.ynxweb4.com",account:ACCOUNT,chainId:"0x1917",wallet:"metamask"});
  for (const input of [
    {origin:"http://wallet.ynxweb4.com",account:ACCOUNT,chainId:"0x1917",wallet:"metamask"},
    {origin:"https://wallet.ynxweb4.com/path",account:ACCOUNT,chainId:"0x1917",wallet:"metamask"},
    {origin:"https://wallet.ynxweb4.com",account:ACCOUNT,chainId:"0x1",wallet:"metamask"},
    {origin:"https://wallet.ynxweb4.com",account:ACCOUNT,chainId:"0x1917",wallet:"unknown"},
  ]) assert.equal(connectedDappRecord(input),null);
});

test("Connected DApps storage rejects cross-origin and tampered state, and local disconnect never claims provider revocation", () => {
  const memory = storage();
  rememberConnectedDapp({origin:"https://wallet.ynxweb4.com",account:ACCOUNT,chainId:"0x1917",wallet:"ynx"},memory);
  assert.equal(readConnectedDapp("https://social.ynxweb4.com",memory),null);
  assert.equal(memory.getItem(CONNECTED_DAPP_KEY),null);
  memory.setItem(CONNECTED_DAPP_KEY, "{");
  assert.equal(readConnectedDapp("https://wallet.ynxweb4.com",memory),null);
  assert.deepEqual(forgetConnectedDapp(memory),{status:"disconnected",walletPermissionRevoked:false});
});

test("provider chooser only remains open until one exact discovered provider is connected", () => {
  assert.deepEqual(providerChooserState({ynx:true,metamask:true}),{choices:["ynx","metamask"],selected:null,connected:null,open:true});
  assert.deepEqual(providerChooserState({ynx:true,metamask:true},"metamask","metamask"),{choices:["ynx","metamask"],selected:"metamask",connected:"metamask",open:false});
  assert.deepEqual(providerChooserState({metamask:true},"ynx","ynx"),{choices:["metamask"],selected:null,connected:null,open:false});
});
