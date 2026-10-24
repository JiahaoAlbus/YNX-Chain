#pragma once
#import <Foundation/Foundation.h>
#include <ynx_project_control.h>
#include <cstring>
// Same-process Main-only fixed-purpose adapter. This is NOT a Source, Root,
// registered role, custody acquisition or generic signer. Original Main must
// reserve/persist its sole effect and independently assert exact current
// capture/pair/role before decrypting this purpose-specific custody record.
// Never pass this record, spans, expected descriptor or function through JS.
namespace ynx_wallet_private {
struct ControlSpan {const uint8_t*bytes=nullptr;size_t length=0;};
struct ControlMaterialBorrow {ControlSpan derA,derB,pkA,pkB;};
inline bool borrowOriginalControlMaterial(const void*record,size_t length,ControlMaterialBorrow&out) noexcept {
 out={};const char magic[]="YNX-PROJECT-CONTROL-CUSTODY/v1\n";if(!record||length>4096||length<sizeof(magic)-1+16)return false;
 auto*p=static_cast<const uint8_t*>(record);size_t at=sizeof(magic)-1;if(std::memcmp(p,magic,at)!=0)return false;
 ControlMaterialBorrow material;ControlSpan*parts[]={&material.derA,&material.derB,&material.pkA,&material.pkB};const size_t sizes[]={54,150,2592,64};
 for(unsigned i=0;i<4;i++){if(length-at<4)return false;uint32_t n=0;for(unsigned k=0;k<4;k++)n=(n<<8)|p[at++];if(n!=sizes[i]||n>length-at)return false;*parts[i]={p+at,n};at+=n;}
 if(at!=length)return false;out=material;return true;
}
struct ControlCABIOutcome {
 NSData*__strong member=nil;int32_t status=YNX_CONTROL_INVALID_ARGUMENT_V1;
 uint32_t cleanup=YNX_CONTROL_CLEANUP_UNKNOWN_V1;bool invoked=false,outputValid=false;
};
inline ControlCABIOutcome invokeOriginalProjectControlCABI(NSMutableData*record,NSData*principal,NSData*command,NSData*decision,const YNXProjectControlExpectedV1&expected,uint64_t observedAt){
 ControlCABIOutcome result;NSMutableData*output=nil;
 @try{
  if(![record isKindOfClass:NSMutableData.class]||!principal.length||principal.length>YNX_PROJECT_CONTROL_PRINCIPAL_MAX_V1||!command.length||command.length>YNX_PROJECT_CONTROL_COMMAND_MAX_V1||!decision.length||decision.length>YNX_PROJECT_CONTROL_DECISION_MAX_V1||!observedAt)return result;
  ControlMaterialBorrow material;if(!borrowOriginalControlMaterial(record.bytes,record.length,material)||expected.network_id.length!=32||!expected.network_id.bytes||expected.pk_a.length!=2592||!expected.pk_a.bytes||expected.pk_b.length!=64||!expected.pk_b.bytes||std::memcmp(material.pkA.bytes,expected.pk_a.bytes,material.pkA.length)||std::memcmp(material.pkB.bytes,expected.pk_b.bytes,material.pkB.length))return result;
  const auto data=[](NSData*b)->YNXProjectControlBytesV1{return {static_cast<const uint8_t*>(b.bytes),b.length};};const auto span=[](ControlSpan s)->YNXProjectControlBytesV1{return {s.bytes,s.length};};
  YNXProjectControlRequestV1 request{};request.abi_version=YNX_PROJECT_CONTROL_ABI_V1;request.struct_size=sizeof(request);request.principal_original=data(principal);request.command_original=data(command);request.decision_original=data(decision);request.expected=expected;request.observed_at_ms=observedAt;request.pkcs8_a=span(material.derA);request.pkcs8_b=span(material.derB);request.pk_a=span(material.pkA);request.pk_b=span(material.pkB);
  output=[NSMutableData dataWithLength:YNX_PROJECT_CONTROL_MEMBER_CAPACITY_V1];size_t written=0;result.invoked=true;
  // One fixed call. No sizing call, callback/provider, alternate purpose,
  // artifact ABI, batch size, fallback key or replacement signing attempt.
  result.status=YNXProjectControlSignV1(&request,static_cast<uint8_t*>(output.mutableBytes),output.length,&written,&result.cleanup);
  if(result.status==YNX_CONTROL_OK_V1&&result.cleanup==YNX_CONTROL_CLEANUP_LOGICAL_COMPLETE_V1&&written>0&&written<=output.length){result.member=[NSData dataWithBytes:output.bytes length:written];result.outputValid=true;}
  return result;
 }@finally{
  // Main's complete mutable borrow and temporary output, including malformed
  // records and thrown callbacks, are wiped. No Go/CIRCL physical-erasure claim.
  if([record isKindOfClass:NSMutableData.class])[record resetBytesInRange:NSMakeRange(0,record.length)];
  if(output)[output resetBytesInRange:NSMakeRange(0,output.length)];
 }
}
}
