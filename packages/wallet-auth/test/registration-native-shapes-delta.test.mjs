// Typed Native DATA boundary models, not Native inventory/installer tests.
import assert from'node:assert/strict';
import{inspectNativeFailureDATA as failure,inspectNativeResponseDATA as response,inspectNativeDrainDATA as drain,inspectNativeHttpStatusDATA as status}from'../native/original-device-v4-registration-native-data.mjs';
const f={present:1,code:0,origin:0,platform_code:'-9223372036854775808'};
assert.equal(failure(f).present,1);assert.equal(drain({failure:f,unknown:0,physical_done:1}).physical_done,1);
const raw=new Uint8Array([1,2,3]),held=response({responsePresent:true,bytes:raw.buffer,httpStatus:200,failure:f});raw.fill(9);assert.deepEqual([...new Uint8Array(held.bytes)],[1,2,3]);
assert.equal(status({version:1,size:56,selected:1,http_entered:2,response_present:0,http_status:0,recovered_original:1,durable_response:0,first_failure:f}).http_entered,2);
for(const v of [{...f,platform_code:'9223372036854775808'},{...f,platform_code:0},{...f,extra:true},{...f,present:true}])assert.throws(()=>failure(v));
for(const v of [{responsePresent:false,bytes:new ArrayBuffer(0),httpStatus:0,failure:f},{responsePresent:true,bytes:new Uint8Array(1),httpStatus:200,failure:f},{responsePresent:true,bytes:new ArrayBuffer(1048577),httpStatus:200,failure:f}])assert.throws(()=>response(v));
assert.throws(()=>drain({failure:f,unknown:0,physical_done:1,extra:1}));let invoked=0;assert.throws(()=>response({responsePresent:true,get bytes(){invoked++;return new ArrayBuffer(1)},httpStatus:200,failure:f}));assert.equal(invoked,0);
console.log('PASS exact Native shapes: present/code0, physical done despite sticky failure, detached originals, unknown2, malformed/extra/accessor rejection; model only');
