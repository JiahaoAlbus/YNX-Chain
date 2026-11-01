// PUBLIC ephemeral keys and supplied registration DATA only; no Root admission.
import{writeFileSync,mkdirSync}from'node:fs';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
import{createScopeFixtureContext}from'../../packages/wallet-auth/test/fixtures/source-v2-public.fixture.mjs';
import{encodeOriginalAuthSourceStatementV2,canonicalOriginalAuthSourceEnvelopeV2}from'../../packages/wallet-auth/native/original-auth-identity-source-v2-verifier.mjs';
import{canonical}from'../../packages/wallet-auth/native/original-auth-identity-source-verifier.mjs';
import{inspectPQAuthorizationView}from'../../packages/wallet-auth/src/pq-wallet-policy.js';
import{createRequire}from'node:module';const {createVerifier,VERSION}=createRequire(new URL('../../packages/wallet-auth/package.json',import.meta.url))('@ynx/batch-v01-candidate');
import{verifyPQRegisteredMemberData}from'../../packages/wallet-auth/src/pq-registered-member.js';
const out=resolve(import.meta.dirname,'../../..','capacity-contract','signed-public');mkdirSync(out,{recursive:true});const ctx=createScopeFixtureContext(),rows=[];
try{for(const [index,role]of ['enrollment','profile','current'].entries()){
 const frame='界'.repeat(170)+'xy',bodyOriginal=canonical({p:'a'.repeat(65528)}),binding={networkId:ctx.network,owner:ctx.owners[index],keyVersion:'18446744073709551615',executionHeight:'18446744073709551615'},message=Buffer.from(encodeOriginalAuthSourceStatementV2(role,frame,binding,bodyOriginal)),member=Buffer.from(ctx.signMember(role,index,message));
 const record=inspectPQAuthorizationView(ctx.registrations[role==='enrollment'?'root':role]).activeRecord,purpose='AUTH-SOURCE-'+role.toUpperCase();
 const verifier=createVerifier({provider:'portable',chainId:Buffer.from(ctx.network,'hex'),purpose,cacheEntries:0,resolveTrustedOwner:()=>({algorithmVersion:VERSION,enabled:true,owner:binding.owner,purpose,policyRevision:binding.keyVersion,chainId:Buffer.from(ctx.network,'hex'),pkA:Buffer.from(record.pkA,'hex'),pkB:Buffer.from(record.pkB,'hex'),activeFrom:0,revokedAt:null})});
 try{if(!verifier.verifyOne(member,{height:0}))throw Error('PUBLIC full AND N1 math required');}finally{verifier.clear();}
 const envelope=Buffer.from(canonicalOriginalAuthSourceEnvelopeV2(role,binding,bodyOriginal,member));
 const files={};for(const [name,bytes]of Object.entries({message,member,envelope,body:Buffer.from(bodyOriginal)})){const path=role+'.'+name+'.bin';writeFileSync(join(out,path),bytes);files[name]={path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
 rows.push({role,binding,purpose,frame,expectedRegisteredPair:{pkA:record.pkA,pkB:record.pkB,activeFrom:record.activeFrom,enabled:true,revokedAt:null},files,directRegisteredPairN1Math:true,actualRegistrationSnapshotSupplied:false,generic65536MessageRejectedByCapacity:true,dataOnly:true,SourceSchemaVerified:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});
 }}finally{ctx.close();}
writeFileSync(join(out,'PUBLIC-GOLDEN.json'),JSON.stringify({schema:'SOLE_SOURCE_V2_CAPACITY_SIGNED_PUBLIC_V1',rows,privateKeysWritten:false,realRegistration:false,realRoot:false},null,2)+'\n');console.log(JSON.stringify({rows:rows.map(r=>({role:r.role,messageBytes:r.files.message.bytes,memberBytes:r.files.member.bytes,envelopeBytes:r.files.envelope.bytes,directRegisteredPairN1Math:r.directRegisteredPairN1Math})),privateKeysWritten:false}));
