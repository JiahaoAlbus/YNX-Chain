#pragma once
#import "original-artifact-publisher-store.h"
#include "original-project-control-cabi.h"
#include <publisher_registration.h>
// Main-private synchronous adapters only. NONE of these functions supplies
// Source/current, explicit consent, registered custody, durable once or retry.
// The owning Native review must reserve its original effect before entry and
// retain the first result before a late-current callback. Never export via
// NAPI/IPC/JS/helper; never substitute account keys for the new publisher pair.
namespace ynx_wallet_private {
struct PublisherGenerationOutcome {
 NSMutableData*__strong record=nil;
 NSData*__strong publicOriginal=nil;
 int32_t status=YNX_ARTIFACT_INVALID_ARGUMENT_V1;
 uint32_t cleanup=YNX_ARTIFACT_CLEANUP_UNKNOWN_V1;
 bool invoked=false;
};
struct PublisherRegistrationOutcome {
 NSData*__strong member=nil;
 int32_t status=YNX_ARTIFACT_INVALID_ARGUMENT_V1;
 uint32_t cleanup=YNX_ARTIFACT_CLEANUP_UNKNOWN_V1;
 bool invoked=false;
};
inline void wipePublisherRegistrationBuffer(NSMutableData*bytes){
 if([bytes isKindOfClass:NSMutableData.class])[bytes resetBytesInRange:NSMakeRange(0,bytes.length)];
}
inline bool publisherRegistrationBytes(NSData*bytes,size_t maximum){return [bytes isKindOfClass:NSData.class]&&bytes.length&&bytes.length<=maximum;}
inline YNXArtifactBytesV1 publisherRegistrationSpan(NSData*bytes){return {static_cast<const uint8_t*>(bytes.bytes),bytes.length};}
inline YNXArtifactBytesV1 publisherRegistrationBorrow(PublisherBytes bytes){return {bytes.bytes,bytes.length};}
inline bool publisherRegistrationExpected(const YNXArtifactPublisherExpectedV1&e){
 return e.network_id.bytes&&e.network_id.length==32&&e.subject_owner.bytes&&e.subject_owner.length==42&&e.account.bytes&&e.account.length&&e.account.length<=256&&e.project_id.bytes&&e.project_id.length&&e.project_id.length<=256&&e.publisher_id.bytes&&e.publisher_id.length&&e.publisher_id.length<=256&&e.publisher_key_version.bytes&&e.publisher_key_version.length&&e.publisher_key_version.length<=20&&e.pk_a.bytes&&e.pk_a.length==2592&&e.pk_b.bytes&&e.pk_b.length==64;
}
// Fixed buffers allocated independently from request, all inputs and scalar
// outputs. CABI checks overlap/layout too. Lengths and cleanup start UNKNOWN;
// only OK+LOGICAL_COMPLETE releases output. There is no size-query/retry call.
inline PublisherGenerationOutcome invokeOriginalPublisherGenerateCABI(const YNXPublisherIdentityV1&identity){
 PublisherGenerationOutcome result;NSMutableData*privateOutput=nil,*publicOutput=nil;
 @try{
  if(!identity.network_id.bytes||identity.network_id.length!=32||!identity.subject_owner.bytes||identity.subject_owner.length!=42||!identity.account.bytes||!identity.account.length||identity.account.length>256||!identity.project_id.bytes||!identity.project_id.length||identity.project_id.length>256||!identity.publisher_id.bytes||!identity.publisher_id.length||identity.publisher_id.length>256||!identity.publisher_key_version.bytes||!identity.publisher_key_version.length||identity.publisher_key_version.length>20)return result;
  YNXPublisherGenerateRequestV1 request{};request.abi_version=YNX_PUBLISHER_REGISTRATION_ABI_V1;request.struct_size=sizeof(request);request.identity=identity;
  privateOutput=[NSMutableData dataWithLength:YNX_PUBLISHER_REGISTRATION_PRIVATE_CAPACITY_V1];publicOutput=[NSMutableData dataWithLength:YNX_PUBLISHER_REGISTRATION_PUBLIC_CAPACITY_V1];size_t privateLength=0,publicLength=0;
  result.invoked=true;result.status=YNXPublisherGenerateV1(&request,static_cast<uint8_t*>(privateOutput.mutableBytes),privateOutput.length,&privateLength,static_cast<uint8_t*>(publicOutput.mutableBytes),publicOutput.length,&publicLength,&result.cleanup);
  if(result.status!=YNX_ARTIFACT_OK_V1||result.cleanup!=YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1||!privateLength||privateLength>privateOutput.length||!publicLength||publicLength>publicOutput.length)return result;
  PublisherMaterialBorrow material;
  if(!borrowPublisherRecord(privateOutput.bytes,privateLength,publicOutput.bytes,publicLength,material))return result;
  // Verify both output public branches against the private storage framing.
  // Cryptographic R13/DER derivation remains the original Go implementation.
  result.publicOriginal=[NSData dataWithBytes:publicOutput.bytes length:publicLength];
  result.record=[NSMutableData dataWithBytes:privateOutput.bytes length:privateLength];return result;
 }@finally{wipePublisherRegistrationBuffer(privateOutput);wipePublisherRegistrationBuffer(publicOutput);}
}
inline bool preparePublisherRegistrationMaterial(NSMutableData*record,NSData*original,const YNXArtifactPublisherExpectedV1&expected,PublisherMaterialBorrow&material){
 material={};if(![record isKindOfClass:NSMutableData.class]||!publisherRegistrationBytes(original,8192)||!publisherRegistrationExpected(expected)||!borrowPublisherRecord(record.bytes,record.length,original.bytes,original.length,material))return false;
 return std::memcmp(material.pkA.bytes,expected.pk_a.bytes,2592)==0&&std::memcmp(material.pkB.bytes,expected.pk_b.bytes,64)==0;
}
inline PublisherRegistrationOutcome invokeOriginalPublisherPoPCABI(NSMutableData*record,NSData*original,NSData*principal,NSData*command,NSData*registration,const YNXArtifactPublisherExpectedV1&expected,uint64_t observedAt){
 PublisherRegistrationOutcome result;NSMutableData*output=nil;
 @try{
  PublisherMaterialBorrow material;if(!observedAt||!publisherRegistrationBytes(principal,8192)||!publisherRegistrationBytes(command,8192)||!publisherRegistrationBytes(registration,16384)||!preparePublisherRegistrationMaterial(record,original,expected,material))return result;
  YNXPublisherPoPRequestV1 request{};request.abi_version=YNX_PUBLISHER_REGISTRATION_ABI_V1;request.struct_size=sizeof(request);request.public_original=publisherRegistrationSpan(original);request.principal_original=publisherRegistrationSpan(principal);request.command_original=publisherRegistrationSpan(command);request.registration_original=publisherRegistrationSpan(registration);request.publisher=expected;request.observed_at_ms=observedAt;
  request.pkcs8_a=publisherRegistrationBorrow(material.pkcs8A);request.pkcs8_b=publisherRegistrationBorrow(material.pkcs8B);request.pk_a=publisherRegistrationBorrow(material.pkA);request.pk_b=publisherRegistrationBorrow(material.pkB);
  output=[NSMutableData dataWithLength:YNX_PUBLISHER_REGISTRATION_MEMBER_CAPACITY_V1];size_t length=0;
  result.invoked=true;result.status=YNXPublisherPoPSignV1(&request,static_cast<uint8_t*>(output.mutableBytes),output.length,&length,&result.cleanup);
  if(result.status==YNX_ARTIFACT_OK_V1&&result.cleanup==YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1&&length&&length<=output.length)result.member=[NSData dataWithBytes:output.bytes length:length];return result;
 }@finally{wipePublisherRegistrationBuffer(record);wipePublisherRegistrationBuffer(output);}
}
inline PublisherRegistrationOutcome invokeOriginalPublisherCustodianCABI(NSMutableData*record,NSData*original,NSData*principal,NSData*command,NSData*registration,NSData*pop,const YNXArtifactPublisherExpectedV1&publisher,const YNXProjectControlExpectedV1&custodian,uint64_t observedAt){
 PublisherRegistrationOutcome result;NSMutableData*output=nil;
 @try{
  ControlMaterialBorrow material;
  if(!observedAt||!publisherRegistrationBytes(original,8192)||!publisherRegistrationBytes(principal,8192)||!publisherRegistrationBytes(command,8192)||!publisherRegistrationBytes(registration,16384)||!publisherRegistrationBytes(pop,YNX_PUBLISHER_REGISTRATION_MEMBER_CAPACITY_V1)||!publisherRegistrationExpected(publisher)||![record isKindOfClass:NSMutableData.class]||!borrowOriginalControlMaterial(record.bytes,record.length,material)||!custodian.network_id.bytes||custodian.network_id.length!=32||!custodian.pk_a.bytes||custodian.pk_a.length!=2592||!custodian.pk_b.bytes||custodian.pk_b.length!=64||std::memcmp(material.pkA.bytes,custodian.pk_a.bytes,2592)||std::memcmp(material.pkB.bytes,custodian.pk_b.bytes,64))return result;
  // BOTH registered custodian branches must differ, not merely the key label.
  if(!std::memcmp(custodian.pk_a.bytes,publisher.pk_a.bytes,2592)||!std::memcmp(custodian.pk_b.bytes,publisher.pk_b.bytes,64))return result;
  YNXPublisherCustodianRequestV1 request{};request.abi_version=YNX_PUBLISHER_REGISTRATION_ABI_V1;request.struct_size=sizeof(request);request.public_original=publisherRegistrationSpan(original);request.principal_original=publisherRegistrationSpan(principal);request.command_original=publisherRegistrationSpan(command);request.registration_original=publisherRegistrationSpan(registration);request.pop_member_original=publisherRegistrationSpan(pop);request.publisher=publisher;request.custodian=custodian;request.observed_at_ms=observedAt;
  request.pkcs8_a={material.derA.bytes,material.derA.length};request.pkcs8_b={material.derB.bytes,material.derB.length};request.pk_a={material.pkA.bytes,material.pkA.length};request.pk_b={material.pkB.bytes,material.pkB.length};
  output=[NSMutableData dataWithLength:YNX_PUBLISHER_REGISTRATION_MEMBER_CAPACITY_V1];size_t length=0;
  result.invoked=true;result.status=YNXPublisherCustodianSignV1(&request,static_cast<uint8_t*>(output.mutableBytes),output.length,&length,&result.cleanup);
  if(result.status==YNX_ARTIFACT_OK_V1&&result.cleanup==YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1&&length&&length<=output.length)result.member=[NSData dataWithBytes:output.bytes length:length];return result;
 }@finally{wipePublisherRegistrationBuffer(record);wipePublisherRegistrationBuffer(output);}
}
}
