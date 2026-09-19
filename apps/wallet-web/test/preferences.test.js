import assert from "node:assert/strict";
import test from "node:test";
import {LEGACY_LOCALE_KEY,LEGACY_THEME_KEY,PREFERENCES_KEY,PREFERENCES_TTL_MS,acceptPreferenceUpdate,loadPreferences,parsePreferencesRecord,savePreferences} from "../src/preferences.js";

function memory(initial={}){const values=new Map(Object.entries(initial));return{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),value:key=>values.get(key)}}
const now=Date.parse("2026-08-14T04:30:00.000Z");

test("locale and theme restore exactly after a second launch",()=>{
  const storage=memory(),first=loadPreferences(storage,now),saved=savePreferences(storage,first.record,{locale:"ar",theme:"dark"},now),second=loadPreferences(storage,now+1000);
  assert.equal(second.status,"restored");assert.deepEqual(second.record,saved);assert.equal(second.record.locale,"ar");assert.equal(second.record.theme,"dark");
});

test("valid legacy display preferences migrate once into the canonical record",()=>{
  const storage=memory({[LEGACY_LOCALE_KEY]:"de",[LEGACY_THEME_KEY]:"light"}),loaded=loadPreferences(storage,now);
  assert.equal(loaded.status,"migrated");assert.equal(loaded.record.revision,1);assert.equal(storage.getItem(LEGACY_LOCALE_KEY),null);assert.ok(storage.getItem(PREFERENCES_KEY));
});

test("invalid JSON, unknown fields and expired records reset without restoring state",()=>{
  for(const encoded of ["{",JSON.stringify({schemaVersion:1}),JSON.stringify({...savePreferences(memory(),{revision:0,locale:"en",theme:"system"},{locale:"en"},now),extra:true})]){
    const storage=memory({[PREFERENCES_KEY]:encoded}),loaded=loadPreferences(storage,now);assert.equal(loaded.status,"rejected");assert.equal(loaded.record.locale,"en");assert.equal(loaded.record.theme,"system");assert.equal(storage.getItem(PREFERENCES_KEY),null);
  }
  const storage=memory(),record=savePreferences(storage,{revision:0,locale:"en",theme:"system"},{theme:"dark"},now);assert.throws(()=>parsePreferencesRecord(record,now+PREFERENCES_TTL_MS+1),error=>error.code==="PREFERENCES_EXPIRED");
});

test("cross-window preference replay and lower revisions fail closed",()=>{
  const storage=memory(),first=savePreferences(storage,{revision:0,locale:"en",theme:"system"},{theme:"dark"},now),second=savePreferences(storage,first,{locale:"ar"},now+1000);
  assert.deepEqual(acceptPreferenceUpdate(first,JSON.stringify(second),now+1001),second);
  assert.throws(()=>acceptPreferenceUpdate(second,JSON.stringify(first),now+1001),error=>error.code==="PREFERENCES_REPLAYED");
});
