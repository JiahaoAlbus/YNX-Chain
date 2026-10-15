import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(process.env.YNX_CREATOR_APP_SOURCE||new URL('./app.js',import.meta.url),'utf8');
const slice=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
async function submit({ai='zh-CN',ui='en',storedAI='ja',storedUI='en',mode='normal'}={}){
 const forms=new Map([['#ai-form',{}],['#ai-locale',ai===null?null:{value:ai}],['#locale',ui===null?null:{value:ui}]]),bodies=[],reads=[],denied=[];let accountReads=0,prevented=0;
 const values=new Map([['ynx.creator.ai-locale',storedAI],['ynx.creator.locale',storedUI],['wallet.session','preserve'],['draft','preserve draft'],['UNKNOWN','preserve unknown']]),before=[...values];
 const fail=name=>()=>{denied.push(name);assert.fail('unentered private dependency: '+name);};
 const context=vm.createContext({$:key=>{assert.ok(forms.has(key));return forms.get(key);},creatorSessionRevision:0,aiCreateRevision:0,showAI:fail('showAI'),status:fail('private status'),fetch:fail('HTTP'),productAuthorization:fail('authorization'),beginCreatorRequest:fail('private request'),loadCreatorFences:fail('private storage'),JSON:{stringify(value){bodies.push(JSON.parse(JSON.stringify(value)));return JSON.stringify(value);}},localStorage:{getItem(key){assert.ok(['ynx.creator.ai-locale','ynx.creator.locale'].includes(key));reads.push(key);if(mode==='method-error')throw new Error('unit optional preference unavailable');return values.get(key);}},Error,DOMException});
 Object.defineProperty(context,'creatorAccount',{get(){accountReads++;return null;}});
 if(mode==='getter-error')Object.defineProperty(context,'localStorage',{get(){reads.push('property');throw new Error('unit optional preference property unavailable');}});
 vm.runInContext(slice('function currentCreatorSession(', '\nconst walletProof=')+'\n'+slice('async function api(', '\nconst json=body=>')+'\n'+slice('const json=body=>','\nasync function sha256Hex')+'\n'+slice('$("#ai-form").onsubmit=', '\nasync function readCreatorAIWire'),context);
 await forms.get('#ai-form').onsubmit({preventDefault(){prevented++;},target:{video_id:{value:'unit-video-not-dispatched'},kind:{value:'summary'},metadata:{checked:true}}});
 assert.equal(prevented,1);assert.equal(denied.length,0);assert.deepEqual([...values],before);
 return {bodies,reads,accountReads};
}
for(const mode of ['normal','method-error','getter-error'])test(`original AI form ${mode} constructs the current explicit AI locale before real no-account API rejection`,async()=>{const p=await submit({mode});assert.equal(p.bodies.length,1);assert.deepEqual(p.bodies[0],{video_id:'unit-video-not-dispatched',kind:'summary',context_classes:['metadata'],output_language:'zh-CN'});assert.deepEqual(p.reads,[]);assert.ok(p.accountReads>=1,'actual API must reach its original no-account guard');});
test('missing AI selector falls back to current UI selector without reading stale persisted AI',async()=>{const p=await submit({ai:null,ui:'ar'});assert.equal(p.bodies.length,1);assert.equal(p.bodies[0].output_language,'ar');assert.deepEqual(p.reads,[]);assert.ok(p.accountReads>=1);});
test('missing both public selectors keeps English fallback and original no-account guard',async()=>{const p=await submit({ai:null,ui:null,storedAI:null,storedUI:null});assert.equal(p.bodies.length,1);assert.equal(p.bodies[0].output_language,'en');assert.deepEqual(p.reads,[]);assert.ok(p.accountReads>=1);});
