import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decodeMember,encodeMember} from '@ynx/batch-v01-candidate';
import {canonical} from '../native/original-auth-identity-source-verifier.mjs';
const fixture=readFileSync(new URL('./fixtures/ide-artifact-cabi-c2e0.json',import.meta.url));
assert.equal(fixture.length,89801);assert.equal(createHash('sha256').update(fixture).digest('hex'),'cac109123523ded21eea35a7f3be0b11a26dc000670260b2fce8ccffb2e97126');
const v=JSON.parse(fixture),wire=Buffer.from(v.memberOriginalBase64,'base64');
const input=()=>({operation:'ide-artifact-signature-data/v1',signatureOriginal:wire.toString('base64url'),manifestOriginal:Buffer.from(v.manifestOriginalBase64,'base64').toString('base64url'),expectedPublicOriginal:Buffer.from(v.registrationOriginalBase64,'base64').toString('base64url')});
const cli=fileURLToPath(new URL('../native/original-auth-identity-source-verifier.mjs',import.meta.url));
function run(body){const r=spawnSync(process.execPath,[cli],{input:typeof body==='string'?body:canonical(body),encoding:'utf8',timeout:7000,maxBuffer:1048576,env:{}});assert.ifError(r.error);assert.equal(r.signal,null);return r;}
function refuses(body){const r=run(body);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/^[A-Z][A-Z0-9_]+\n$/);return r;}
test('fixed original CLI actually verifies C ABI originals without Source or authority promotion',()=>{
 const r=run(input());assert.equal(r.status,0);assert.equal(r.stderr,'');assert.ok(Buffer.byteLength(r.stdout)<=4097);const d=JSON.parse(r.stdout);assert.equal(r.stdout,canonical(d)+'\n');assert.equal(d.account,v.expected.account);assert.equal(d.projectId,v.expected.projectID);assert.equal(d.publisherId,v.expected.publisherID);assert.equal(d.signatureVerified,true);assert.equal(d.memberCount,1);assert.equal(d.memberIndex,0);assert.equal(d.dataOnly,true);for(const k of ['trusted','authorized','nativeAdmission','registered','current','publicationAuthorized'])assert.equal(d[k],false);assert.equal(Object.hasOwn(d,'signatureOriginal'),false);assert.equal(Object.hasOwn(d,'expectedPublicOriginal'),false);
});
test('fixed CLI independently rejects each actual AND signature branch and a changed manifest',()=>{
 for(const key of ['sigmaA','sigmaB']){const m=decodeMember(wire);m.certificate[key][0]^=1;const x=input();x.signatureOriginal=encodeMember(m).toString('base64url');assert.equal(refuses(x).stderr,'IDE_ARTIFACT_SIGNATURE_DATA_INVALID\n');}
 const x=input(),m=JSON.parse(Buffer.from(x.manifestOriginal,'base64url'));m.contentDigest='0'.repeat(64);x.manifestOriginal=Buffer.from(canonical(m)).toString('base64url');assert.equal(refuses(x).stderr,'IDE_ARTIFACT_SIGNATURE_DATA_INVALID\n');
});
test('fixed CLI has exact canonical bytes, field set and no provider or endpoint injection',()=>{
 for(const extra of ['provider','module','endpoint','clock','approved'])refuses({...input(),[extra]:true});
 const x=input();delete x.expectedPublicOriginal;refuses(x);refuses({...x,publicOriginal:input().expectedPublicOriginal});
 refuses(JSON.stringify(input()));refuses(canonical(input())+'\n');
 const raw=canonical(input());refuses('{"operation":"ide-artifact-signature-data/v1",'+raw.slice(1));
 for(const key of ['signatureOriginal','manifestOriginal','expectedPublicOriginal'])for(const value of ['',null,{},'YQ==','YQ\n','YR'])refuses({...input(),[key]:value});
});
test('fixed CLI bounds each original and request before mathematics and emits no partial success',()=>{
 for(const [key,cap]of [['signatureOriginal',100000],['manifestOriginal',16384],['expectedPublicOriginal',8192]])refuses({...input(),[key]:Buffer.alloc(cap+1,1).toString('base64url')});
 assert.equal(refuses({...input(),signatureOriginal:'A'.repeat(262145)}).stderr,'IDE_ARTIFACT_SIGNATURE_DISPATCH_CAPACITY\n');
 const x=input();x.signatureOriginal=Buffer.concat([wire,Buffer.from([0])]).toString('base64url');refuses(x);
});
