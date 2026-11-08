import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyNative10Inputs,verifySymbols,strong} from '../../../scripts/ci/android-pending-native10-inputs.mjs';
test('exact Native14/Main header/current Auth headers and 32+38 finite cases',()=>{const m=verifyNative10Inputs();assert.equal(m.actualMainRustLinked,false);assert.equal(m.RootAdmission,false);assert.equal(new Set(m.pins.map(p=>p.path)).size,m.pins.length);});
test('normal ten strong definitions required and PUBLIC hook refused',()=>{const s=strong.map(n=>'000 T '+n).join('\n');verifySymbols(s);assert.throws(()=>verifySymbols(s.replace(' T ',' U ')),/MISSING_STRONG/);assert.throws(()=>verifySymbols(s+'\n T ynx_android_pending_directory_PUBLIC_close'),/NORMAL_PUBLIC_HOOK/);});
