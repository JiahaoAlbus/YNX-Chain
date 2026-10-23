#pragma once
#import "original-artifact-publisher-store.h"
#include <ynx_artifact_release.h>
// Fixed same-process private body. The owning original approval MUST consume
// its once entry before reading custody, and retain this public outcome before
// any post-current/lock/callback checks. This helper supplies NO Source, review,
// user approval, retry, broadcast or handoff authority. Never export to NAPI.
// currentR/currentBinding come from independent original current Source, NOT
// a renderer, the custody record itself, or a descriptor supplied by a caller.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunused-function"
#import "../../../packages/wallet-auth/native/original-ide-project-authority-data.h"
#pragma clang diagnostic pop
namespace ynx_wallet_private {
struct PublisherCABIOutcome {
 NSData*__strong member=nil;
 int32_t status=YNX_ARTIFACT_INVALID_ARGUMENT_V1;
 uint32_t cleanup=YNX_ARTIFACT_CLEANUP_UNKNOWN_V1;
 bool invoked=false;
};
// Public R13 spans only, after the ORIGINAL Auth DATA parser has validated all
// framing, fixed purpose/role and metadata. No parallel signature/R13 semantics.
inline bool publisherSourceSpans(NSData*r,PublisherBytes&network,PublisherBytes&pkA,PublisherBytes&pkB) noexcept {
 network=pkA=pkB={};if(!r||r.length<4||r.length>8192)return false;
 const auto*p=static_cast<const uint8_t*>(r.bytes);size_t at=4;
 for(unsigned i=0;i<13;i++){
  if(r.length-at<4)return false;uint32_t n=0;for(unsigned j=0;j<4;j++)n=(n<<8)|p[at++];
  if(!n||n>r.length-at)return false;
  if(i==5)network={p+at,n};if(i==11)pkA={p+at,n};if(i==12)pkB={p+at,n};at+=n;
 }
 return at==r.length&&network.length==32&&pkA.length==2592&&pkB.length==64;
}
inline PublisherCABIOutcome invokeOriginalPublisherCABI(NSMutableData*record,NSData*currentR,NSDictionary*currentBinding,NSData*manifest) {
 PublisherCABIOutcome result;
 @try {
  if(![record isKindOfClass:NSMutableData.class]||!record.length||record.length>16384||!currentR||!manifest||!manifest.length||manifest.length>YNX_ARTIFACT_PUBLICATION_MANIFEST_MAX_V1)return result;
  NSDictionary*parsed=SourceProjectR13(currentR);
  if(!parsed||![parsed isEqual:currentBinding])return result;
  PublisherMaterialBorrow material;PublisherBytes network,pkA,pkB;
  if(!borrowPublisherRecord(record.bytes,record.length,currentR.bytes,currentR.length,material)||!publisherSourceSpans(currentR,network,pkA,pkB))return result;
  // All expected fields derive from independently held Source originals. The
  // custody record must match that full R, never establish its own expected R.
  NSData*owner=[parsed[@"subjectOwner"]dataUsingEncoding:NSUTF8StringEncoding],*account=[parsed[@"account"]dataUsingEncoding:NSUTF8StringEncoding],*project=[parsed[@"projectId"]dataUsingEncoding:NSUTF8StringEncoding],*publisher=[parsed[@"publisherId"]dataUsingEncoding:NSUTF8StringEncoding],*version=[parsed[@"publisherKeyVersion"]dataUsingEncoding:NSUTF8StringEncoding];
  const auto span=[](PublisherBytes b)->YNXArtifactBytesV1{return {b.bytes,b.length};};
  const auto data=[](NSData*b)->YNXArtifactBytesV1{return {static_cast<const uint8_t*>(b.bytes),b.length};};
  YNXArtifactPublicationRequestV1 request{};
  request.abi_version=YNX_ARTIFACT_PUBLICATION_ABI_V1;request.struct_size=sizeof(request);
  request.registration_original=span(material.registration);request.manifest_original=data(manifest);
  request.expected={span(network),data(owner),data(account),data(project),data(publisher),data(version),span(pkA),span(pkB)};
  request.pkcs8_a=span(material.pkcs8A);request.pkcs8_b=span(material.pkcs8B);request.pk_a=span(material.pkA);request.pk_b=span(material.pkB);
  // One fixed-capacity call. No sizing call, output overlap, runtime callback,
  // provider override, helper IPC, key copy or replacement signing attempt.
  NSMutableData*output=[NSMutableData dataWithLength:YNX_ARTIFACT_PUBLICATION_MEMBER_CAPACITY_V1];size_t length=0;
  result.invoked=true;
  result.status=YNXArtifactPublicationSignV1(&request,static_cast<uint8_t*>(output.mutableBytes),output.length,&length,&result.cleanup);
  if(result.status==YNX_ARTIFACT_OK_V1&&result.cleanup==YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1&&length>0&&length<=output.length)result.member=[NSData dataWithBytes:output.bytes length:length];
  // No physical Go/CIRCL erasure claim: the ABI only attests explicit logical
  // Clear/Destroy. Main's exact original mutable custody record is wiped below.
  return result;
 } @finally {
  // Even malformed input, failed import/signing, allocation exception and
  // unknown cleanup must never leave Main's original private copy unwiped.
  if([record isKindOfClass:NSMutableData.class])[record resetBytesInRange:NSMakeRange(0,record.length)];
 }
}
}
