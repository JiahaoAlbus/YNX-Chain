import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "../plugins/withYnxAndroidExactIntentFilters.js";

const exact={
  action:[{$:{"android:name":"android.intent.action.VIEW"}}],
  category:[{$:{"android:name":"android.intent.category.DEFAULT"}},{$:{"android:name":"android.intent.category.BROWSABLE"}}],
  data:["authorize","action","wc","open"].map((host)=>({$:{"android:scheme":"ynxwallet","android:host":host}})),
};
const universal={$:{"android:autoVerify":"true"},action:[{$:{"android:name":"android.intent.action.VIEW"}}],category:[{$:{"android:name":"android.intent.category.DEFAULT"}},{$:{"android:name":"android.intent.category.BROWSABLE"}}],data:[{$:{"android:scheme":"https","android:host":"www.ynxweb4.com","android:path":"/dapp/wallet/open"}}]};
const fixture=(walletFilter=exact,universalFilter=universal)=>({application:[{activity:[{$:{"android:name":".MainActivity"},"intent-filter":[
  {action:[{$:{"android:name":"android.intent.action.MAIN"}}]},
  {action:[{$:{"android:name":"android.intent.action.VIEW"}}],data:[{$:{"android:scheme":"ynxwallet"}}]},
  walletFilter,
  universalFilter,
]}]}]});

test("Expo prebuild removes the scheme-only route and retains only the exact Wallet hosts",()=>{
  const manifest=plugin.applyExactIntentFilters(fixture());
  const filters=manifest.application[0].activity[0]["intent-filter"];
  assert.equal(filters.length,3);
  assert.deepEqual(filters[1].data.map((item)=>item.$["android:host"]),["authorize","action","wc","open"]);
});

test("Expo prebuild retains only the exact verified Wallet universal link",()=>{const manifest=plugin.applyExactIntentFilters(fixture());const route=manifest.application[0].activity[0]["intent-filter"][2];assert.equal(route.$["android:autoVerify"],"true");assert.deepEqual(route.data[0].$,{"android:scheme":"https","android:host":"www.ynxweb4.com","android:path":"/dapp/wallet/open"})});

test("Expo prebuild fails closed on route widening",()=>{
  const widened=structuredClone(exact);
  widened.data.push({$:{"android:scheme":"ynxwallet","android:host":"unknown"}});
  assert.throws(()=>plugin.applyExactIntentFilters(fixture(widened)),/canonical routes/);
});
