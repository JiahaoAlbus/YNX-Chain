import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyCanonicalNativeSourceSelection} from './package-identity-admission-source.mjs';
const i=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
test('actual source preflight verifies same-root SDK39 record/module and producer evidence without loading Native',async()=>{const r=await verifyCanonicalNativeSourceSelection(i.roots.native,i.roots.native);assert.equal(r.sourceLeaves,124);assert.equal(r.buildInputLeaves,112);assert.equal(r.nativeQualified,false);assert.equal(r.registrationAccepted,false);});
