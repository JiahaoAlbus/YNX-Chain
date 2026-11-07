import {types} from 'node:util';
// Copyable DATA only. This module cannot acquire Source, read a directory, or sign.
const topKeys = ['realm','epoch','sequence','headSHA256','rootSHA256','devices'];
const rowKeys = ['device','generation','registrationSHA256','state'];
const maximumU64 = 18446744073709551615n;
function reject() { throw new TypeError('SOCIAL_F06_DIRECTORY_DATA_INVALID'); }
function fields(value, keys) {
  if (types.isProxy(value) || !value || typeof value !== 'object' || ![null,Object.prototype].includes(Object.getPrototypeOf(value))) reject();
  const d = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(d).length !== keys.length || keys.some(k => !Object.hasOwn(d,k) || !Object.hasOwn(d[k],'value') || !d[k].enumerable)) reject();
  return Object.fromEntries(keys.map(k => [k,d[k].value]));
}
function u64(v, positive = false) {
  if (typeof v !== 'string' || v.length > 20 || !/^(0|[1-9][0-9]*)$/.test(v)) reject();
  const n = BigInt(v); if (n > maximumU64 || (positive && n === 0n)) reject();
  return v;
}
function digest(v) { if (typeof v !== 'string' || v.length !== 64 || !/^[0-9a-f]{64}$/.test(v)) reject(); return v; }
function device(v) { if (typeof v !== 'string' || v.length < 1 || v.length > 128 || !/^[\x21-\x7e]+$/.test(v)) reject(); return v; }
function row(value) {
  const r = fields(value,rowKeys);
  if (r.state !== 'committed' && r.state !== 'revoked') reject();
  return Object.freeze({device:device(r.device),generation:u64(r.generation,true),registrationSHA256:digest(r.registrationSHA256),state:r.state});
}
/** Validate and copy already obtained DATA. Realm transport limit is not supplied. */
export function copySocialF06DirectoryDATA(value) {
  const v = fields(value,topKeys);
  if (typeof v.realm !== 'string' || types.isProxy(v.devices) || !Array.isArray(v.devices)) reject();
  const d = Object.getOwnPropertyDescriptors(v.devices);
  const count = d.length?.value;
  if (!Number.isInteger(count) || count < 1 || count > 4096 || Reflect.ownKeys(d).length !== count + 1) reject();
  const devices = [];
  for (let i=0;i<count;i++) {
    const item = d[String(i)]; if (!item || !Object.hasOwn(item,'value') || !item.enumerable) reject();
    const r = row(item.value), previous = devices.at(-1);
    if (previous && (previous.device > r.device || (previous.device === r.device && BigInt(previous.generation) >= BigInt(r.generation)))) reject();
    devices.push(r);
  }
  return Object.freeze({realm:v.realm,epoch:u64(v.epoch),sequence:u64(v.sequence),headSHA256:digest(v.headSHA256),rootSHA256:digest(v.rootSHA256),devices:Object.freeze(devices)});
}
/** Pure equality fence, not a Native current or authorization check. */
export function sameSocialF06DirectoryDATA(original, current) {
  const a = copySocialF06DirectoryDATA(original), b = copySocialF06DirectoryDATA(current);
  return JSON.stringify(a) === JSON.stringify(b);
}
/** Select copyable target DATA from this snapshot; no DeviceOriginals/Source grant. */
export function selectSocialF06DirectoryTargetDATA(snapshot, targetDevice, generation) {
  const v = copySocialF06DirectoryDATA(snapshot); device(targetDevice);u64(generation,true);
  return v.devices.find(r => r.device === targetDevice && r.generation === generation) ?? null;
}
