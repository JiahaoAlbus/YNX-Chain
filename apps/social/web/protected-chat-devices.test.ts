import test from 'node:test';
import assert from 'node:assert/strict';
import {protectedChatDevices,openChatDevice,type ProtectedChatCarrier,type ChatCarrierStorage} from './protected-chat-devices';

const account=`ynx1${'a'.repeat(38)}`,other=`ynx1${'b'.repeat(38)}`;
const original=JSON.stringify({account,deviceId:'social-original-device',signingSeed:'07'.repeat(32),encryptionSeed:'08'.repeat(32),legacyExtra:'retained'});
function fixture(){
  const records=new Map<string,ProtectedChatCarrier>(),legacy=new Map<string,string>();let writes=0,deleteFails=false,readFails=false;
  const storage:ChatCarrierStorage={async load(account){if(readFails)throw new Error('injected read failure');const value=records.get(account);return value?structuredClone(value):null},async insert(account,carrier){writes++;if(!records.has(account))records.set(account,structuredClone(carrier))},async legacy(account){return legacy.get(account)??null},async removeLegacy(account,expected){if(deleteFails)throw new Error('injected interrupted cleanup');if(legacy.get(account)!==expected)throw new Error('legacy changed');legacy.delete(account)}};
  const environment={crypto:globalThis.crypto,isSecureContext:true,location:{origin:'https://social.ynxweb4.com'}};
  return {records,legacy,storage,environment,devices:protectedChatDevices(storage,environment),counts:()=>writes,failDelete:(value:boolean)=>{deleteFails=value},failRead:(value:boolean)=>{readFails=value}};
}
test('new device persists only authenticated ciphertext and a nonextractable CryptoKey, then cold restores exact keys',async()=>{
  const f=fixture(),device=await f.devices.get(account,true),carrier=f.records.get(account)!;
  const persisted=JSON.stringify(carrier);assert.equal(persisted.includes(device.signingSeed),false);assert.equal(persisted.includes(device.encryptionSeed),false);assert.equal(carrier.key.extractable,false);
  await assert.rejects(crypto.subtle.exportKey('raw',carrier.key));
  assert.deepEqual(await protectedChatDevices(f.storage,f.environment).get(account,false),device);
  assert.equal(JSON.parse(await openChatDevice(crypto,account,carrier)).deviceId,device.deviceId);
});
test('tamper, key loss, account mismatch and insecure origin never substitute replacement seeds',async()=>{
  const f=fixture();await f.devices.get(account,true);const carrier=f.records.get(account)!;const count=f.counts();
  await assert.rejects(openChatDevice(crypto,other,carrier),/retained/);
  const changed=structuredClone(carrier);new Uint8Array(changed.ciphertext)[0]!^=1;f.records.set(account,changed);
  await assert.rejects(f.devices.get(account,true),/retained/);assert.equal(f.counts(),count);
  f.records.set(account,{...carrier,key:undefined as unknown as CryptoKey});await assert.rejects(f.devices.get(account,true),/retained/);assert.equal(f.counts(),count);
  await assert.rejects(protectedChatDevices(f.storage,{...f.environment,isSecureContext:false}).get(account,true),/HTTPS/);assert.equal(f.counts(),count);
});
test('legacy plaintext blocks automatic migration; explicit protection preserves exact raw bytes and unknown fields',async()=>{
  const f=fixture();f.legacy.set(account,original);
  await assert.rejects(f.devices.get(account,true),/explicit protection/);assert.equal(f.counts(),0);assert.equal(f.legacy.get(account),original);
  await assert.rejects(f.devices.protectLegacy(account,false),/Confirm/);assert.equal(f.counts(),0);
  const device=await f.devices.protectLegacy(account,true);assert.equal(device.signingSeed,'07'.repeat(32));assert.equal(device.legacyExtra,'retained');assert.equal(f.legacy.has(account),false);
  assert.equal(await openChatDevice(crypto,account,f.records.get(account)!),original);assert.deepEqual(await f.devices.get(account,false),JSON.parse(original));
});
test('interrupted protection cleanup preserves old carrier and resumes without minting another wrapping key/device',async()=>{
  const f=fixture();f.legacy.set(account,original);f.failDelete(true);await assert.rejects(f.devices.protectLegacy(account,true),/interrupted/);assert.equal(f.legacy.get(account),original);assert.equal(f.counts(),1);
  await assert.rejects(f.devices.get(account,false),/explicit protection/);f.failDelete(false);await f.devices.protectLegacy(account,true);assert.equal(f.counts(),1);assert.equal(await openChatDevice(crypto,account,f.records.get(account)!),original);
});
test('lost readback and changed legacy carrier fail closed and never delete the original',async()=>{
  const f=fixture();f.legacy.set(account,original);f.failRead(true);await assert.rejects(f.devices.protectLegacy(account,true));assert.equal(f.legacy.get(account),original);assert.equal(f.counts(),0);
  f.failRead(false);await f.storage.insert(account,await (await import('./protected-chat-devices')).sealChatDevice(crypto,account,original));f.legacy.set(account,original.replace('retained','changed'));await assert.rejects(f.devices.protectLegacy(account,true),/retained/);assert.equal(f.legacy.get(account),original.replace('retained','changed'));
});
