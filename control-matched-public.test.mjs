// PUBLIC DATA controls: no supplier paths/assets are opened or Native executed.
import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
import{assertMatchedNodeCohortDATA}from'./normal-product.mjs';
const c=JSON.parse(fs.readFileSync(new URL('./NORMAL_PRODUCT_CONTRACT.json',import.meta.url)));
test('matching cohort only accepts exact new record and image family',()=>{assert.equal(assertMatchedNodeCohortDATA(c),true);for(const k of ['record','image']){const x=structuredClone(c);x.matchedNode[k].sha256='0'.repeat(64);assert.throws(()=>assertMatchedNodeCohortDATA(x),e=>e.code==='CONTROL_MATCHED_EXACT_RECORD_IMAGE');}});
test('Node composite cannot masquerade as inherited Cocoa compile role',()=>{for(const f of [x=>x.roles.CocoaCompiledSDK=x.roles.SDKPublic,x=>x.roles.NodeComposite.projectControlSource=x.roles.NativeCPP,x=>x.matchedNode.qualification.retainedObjects=83]){const x=structuredClone(c);f(x);assert.throws(()=>assertMatchedNodeCohortDATA(x),e=>e.code==='CONTROL_MATCHED_COMPOSITE_ROLE');}});
test('cohort rejects old node family, extra generated asset and wrong image hash',()=>{for(const f of [x=>x.assets[0].role='C6_NODE9',x=>x.assets.push({...x.assets[0]}),x=>x.assets[0].sha256='e'.repeat(64)]){const x=structuredClone(c);f(x);assert.throws(()=>assertMatchedNodeCohortDATA(x),e=>e.code==='CONTROL_MATCHED_ASSET_FAMILY');}});
