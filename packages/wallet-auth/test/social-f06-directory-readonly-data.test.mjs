import test from 'node:test';
import assert from 'node:assert/strict';
import {copySocialF06DirectoryDATA as copy,sameSocialF06DirectoryDATA as same,selectSocialF06DirectoryTargetDATA as select} from '../native/social-f06-directory-readonly-data.mjs';
const hash = 'a'.repeat(64);
const make = () => ({realm:'social',epoch:'0',sequence:'0',headSHA256:hash,rootSHA256:hash,devices:[{device:'device-A',generation:'2',registrationSHA256:hash,state:'committed'},{device:'device-A',generation:'10',registrationSHA256:hash,state:'revoked'}]});
const invalid = f => assert.throws(f,{message:'SOCIAL_F06_DIRECTORY_DATA_INVALID'});
test('copy immutable exact DATA, both observable states and numerical generation order',()=>{
 const v=make(),c=copy(v);v.devices[0].state='revoked';assert.equal(c.devices[0].state,'committed');assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.devices)&&Object.isFrozen(c.devices[0]));assert.deepEqual(Object.keys(c),['realm','epoch','sequence','headSHA256','rootSHA256','devices']);
 assert.equal(select(c,'device-A','10').state,'revoked');assert.equal(select(c,'absent','1'),null);assert.equal(same(c,make()),true);
});
test('no private record, authority, operation or unknown fields cross exact closure',()=>{
 for(const key of ['Subject','Attempt','Binding','Challenge','Proposal','operation','sourceRef','qualified','version']){const v=make();v[key]='hidden';invalid(()=>copy(v));const w=make();w.devices[0][key]='hidden';invalid(()=>copy(w));}
});
test('u64 exact strings and boundary, positive generation, lowercase full digests',()=>{
 for(const n of [0,1,'01','-1','1.0','1\n','18446744073709551616']){const v=make();v.epoch=n;invalid(()=>copy(v));}
 const v=make();v.epoch='18446744073709551615';copy(v);
 for(const n of ['0','00',1]){const w=make();w.devices[0].generation=n;invalid(()=>copy(w));}
 for(const h of ['A'.repeat(64),hash+'\n','a'.repeat(63)]){const w=make();w.headSHA256=h;invalid(()=>copy(w));}
});
test('same-snapshot equality rejects each changed scalar or row; no current grant',()=>{
 for(const key of ['realm','epoch','sequence','headSHA256','rootSHA256']){const v=make();v[key]=['epoch','sequence'].includes(key)?'1':key==='realm'?'other':'b'.repeat(64);assert.equal(same(make(),v),false);}
 for(const key of ['device','generation','registrationSHA256','state']){const v=make();v.devices[1][key]={device:'device-B',generation:'11',registrationSHA256:'b'.repeat(64),state:'committed'}[key];assert.equal(same(make(),v),false);}
});
test('Go device ASCII, sort/unique, row count and states',()=>{
 for(const d of ['', 'bad space','é','a'.repeat(129)]){const v=make();v.devices[0].device=d;invalid(()=>copy(v));}
 for(const change of [v=>v.devices.reverse(),v=>v.devices[1].generation='2',v=>v.devices=[],v=>v.devices[0].state='prepared',v=>v.devices=new Array(4097)]){const v=make();change(v);invalid(()=>copy(v));}
});
test('accessors, symbols, sparse arrays and array metadata rejected without getter execution',()=>{
 let invoked=false;const v=make();Object.defineProperty(v,'realm',{enumerable:true,get(){invoked=true;throw Error('getter');}});invalid(()=>copy(v));assert.equal(invoked,false);
 const w=make();w[Symbol('authority')]=true;invalid(()=>copy(w));const x=make();delete x.devices[0];invalid(()=>copy(x));const y=make();y.devices.extra=true;invalid(()=>copy(y));
});

test('Node private DATA boundary rejects object and array Proxy before any reflection traps',()=>{
 for(const array of [false,true]){
  let traps=0;const p=new Proxy(array?make().devices:make(),{getPrototypeOf(){traps++;return array?Array.prototype:Object.prototype;},ownKeys(t){traps++;return Reflect.ownKeys(t);},getOwnPropertyDescriptor(t,k){traps++;return Reflect.getOwnPropertyDescriptor(t,k);}});
  invalid(()=>copy(array?{...make(),devices:p}:p));assert.equal(traps,0);
 }
});
