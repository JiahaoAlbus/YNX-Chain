import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectFullOperatorDeploymentIdentity} from '../src/features/pq-transaction/operator-deployment-identity.mjs';
const expected={origin:'https://public.example.invalid',chainId:6423,reportedCommit:'123456789abc'+'1'.repeat(28),reportedRelease:'PUBLIC-fixture-full40-release',genesisHash:'2'.repeat(64),spkiSha256:'3'.repeat(64)};
const original=()=>({origin:expected.origin,spkiSha256:expected.spkiSha256,status:{chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:expected.reportedCommit,release:expected.reportedRelease}},genesis:{height:0,hash:expected.genesisHash}});
test('full40 fixture exact identity matches DATA only, without authenticating TLS, deployment receipt or broadcast authority',()=>{
 const result=inspectFullOperatorDeploymentIdentity(expected,original());assert.equal(result.identityMatches,true);for(const key of ['liveReadback','TLSAuthenticated','receiptAuthenticated','SourceQualified','broadcastAuthorized'])assert.equal(result[key],false);
});
test('same12 prefix but different40, truncated commit and wrong release are not accepted aliases',()=>{
 for(const commit of [expected.reportedCommit.slice(0,12)+'4'.repeat(28),expected.reportedCommit.slice(0,12),expected.reportedCommit.toUpperCase()]){const bad=original();bad.status.build.commit=commit;assert.throws(()=>inspectFullOperatorDeploymentIdentity(expected,bad),/OPERATOR_DEPLOYMENT_VERSION_OR_HEALTH_DIFFERS/);}
 const release=original();release.status.build.release+='-other';assert.throws(()=>inspectFullOperatorDeploymentIdentity(expected,release),/OPERATOR_DEPLOYMENT_VERSION_OR_HEALTH_DIFFERS/);
 assert.throws(()=>inspectFullOperatorDeploymentIdentity({...expected,reportedCommit:expected.reportedCommit.slice(0,12)},original()),/OPERATOR_DEPLOYMENT_BINDING_INVALID/);
});
test('wrong genesis, SPKI, origin, chain or health refuses without fallback',()=>{
 const changes=[['genesis',v=>v.genesis.hash='5'.repeat(64)],['genesis',v=>v.genesis.height=1],['spki',v=>v.spkiSha256='6'.repeat(64)],['origin',v=>v.origin='https://alternate.example.invalid'],['version',v=>v.status.chainId=1],['version',v=>v.status.catchingUp=true],['version',v=>v.status.persistence=false],['version',v=>v.status.persistenceError='fault']];
 for(const [,change]of changes){const bad=original();change(bad);assert.throws(()=>inspectFullOperatorDeploymentIdentity(expected,bad));}
 for(const origin of ['http://public.example.invalid','https://public.example.invalid/','https://user:pass@public.example.invalid','https://public.example.invalid?override=1'])assert.throws(()=>inspectFullOperatorDeploymentIdentity({...expected,origin},original()),/OPERATOR_DEPLOYMENT_BINDING_INVALID/);
});
test('no deployment receipt means current65 config is preserved and candidate/full40 validator remains unactivated',()=>{
 const query=fs.readFileSync(new URL('../src/original-policy-supplier/operator-query.mjs',import.meta.url),'utf8'),transport=fs.readFileSync(new URL('../src/features/pq-transaction/node-transport.mjs',import.meta.url),'utf8');
 assert(query.includes("reportedCommit:'65efa82e0615'"));assert(query.includes("reportedRelease:'ynx-network-surgical-65efa82e0615'"));
 assert(!query.includes('operator-deployment-identity.mjs'));assert(!transport.includes('operator-deployment-identity.mjs'));
 assert(transport.includes("from '../../original-policy-supplier/operator-query.mjs'"));
});
