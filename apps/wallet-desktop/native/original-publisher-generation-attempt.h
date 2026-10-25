#pragma once
#include "original-publisher-registration-cabi.h"
namespace ynx_wallet_private {
// Private effect/storage lifecycle, NOT an authority factory. Only the real
// admitted generation-review owner may construct/enter this body, AFTER its
// explicit visible choice and exact current checks. No callback, signer,
// Source selector, purpose override or boolean approval argument exists here.
// The public request is the original immutable Source request, not a freshly
// minted recovery ID. Caller identity spans must remain live during execute.
class PublisherGenerationAttempt final {
 YNXOriginalArtifactPublisherStore*__strong store_;
 NSData*__strong request_;
 NSMutableData*__strong firstRecord_=nil;
 NSData*__strong firstPublic_=nil;
 NSError*__strong firstCause_=nil;
 NSError*__strong storageCause_=nil;
 bool selected_=false,entered_=false,stored_=false,closed_=false,busy_=false,saving_=false;
 int32_t status_=YNX_ARTIFACT_INVALID_ARGUMENT_V1;
 uint32_t cleanup_=YNX_ARTIFACT_CLEANUP_UNKNOWN_V1;
 void first(NSError*e){if(!firstCause_)firstCause_=e;}
 static NSError*failure(NSString*code){return[NSError errorWithDomain:@"YNXPublisherGenerationAttempt" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];}
 public:
 PublisherGenerationAttempt(YNXOriginalArtifactPublisherStore*store,NSData*originalRequest):store_(store){
  if([originalRequest isKindOfClass:NSData.class]&&originalRequest.length&&originalRequest.length<=16384)request_=[NSData dataWithBytes:originalRequest.bytes length:originalRequest.length];
 }
 PublisherGenerationAttempt(const PublisherGenerationAttempt&)=delete;
 PublisherGenerationAttempt&operator=(const PublisherGenerationAttempt&)=delete;
 ~PublisherGenerationAttempt(){wipePublisherRegistrationBuffer(firstRecord_);}
 // Select in memory before the first store boundary. The existing store also
 // creates the protected durable intent before ANY entropy/crypto entry. A
 // duplicate or uncertain intent cannot cause key replacement on a cold owner.
 bool execute(const YNXPublisherIdentityV1&identity,NSError**error){
  if(error)*error=nil;
  if(busy_||selected_||closed_||!request_||[store_ class]!=YNXOriginalArtifactPublisherStore.class){if(error)*error=firstCause_?:failure(@"PUBLISHER_GENERATION_ONCE_REFUSED");return false;}
  selected_=true;busy_=true;
  @try{
   NSError*cause=nil;if(![store_ beginOriginalGenerationForRequest:request_ error:&cause]||cause){first(cause?:failure(@"PUBLISHER_GENERATION_INTENT_UNKNOWN"));if(error)*error=firstCause_;return false;}
   // Conservatively fence a thrown ABI boundary as entered/UNKNOWN even if
   // it never returned its local invoked flag. Never infer "not generated".
   entered_=true;auto result=invokeOriginalPublisherGenerateCABI(identity);entered_=result.invoked;status_=result.status;cleanup_=result.cleanup;
   // Adopt the first private output BEFORE any foreign persistence callback.
   // This member owns it on a failed save; explicit save retries only these
   // SAME bytes, never calls generation or reacquires a Source/key.
   firstRecord_=result.record;firstPublic_=result.publicOriginal;
   if(!firstRecord_||!firstPublic_){first(failure(@"PUBLISHER_GENERATION_RESULT_UNKNOWN"));if(error)*error=firstCause_;return false;}
   return saveResult(error);
  }@catch(NSException*){first(failure(@"PUBLISHER_GENERATION_EXCEPTION_UNKNOWN"));if(error)*error=firstCause_;return false;}@finally{busy_=false;}
 }
 bool saveOriginalResult(NSError**error){
  if(error)*error=nil;if(busy_||saving_){if(error)*error=failure(@"PUBLISHER_GENERATION_BUSY");return false;}return saveResult(error);
 }
 private:
 bool saveResult(NSError**error){
  if(error)*error=nil;if(stored_)return true;
  if(saving_||!selected_||closed_||!firstRecord_||!firstPublic_){if(error)*error=firstCause_?:failure(@"PUBLISHER_GENERATION_ORIGINAL_RESULT_REQUIRED");return false;}saving_=true;
  @try{NSError*cause=nil;bool ok=[store_ saveOriginalGeneratedRecord:firstRecord_ forPublicOriginal:firstPublic_ requestOriginal:request_ error:&cause]&&!cause;
   if(!ok){if(!storageCause_)storageCause_=cause?:failure(@"PUBLISHER_GENERATION_RESULT_STORAGE_UNKNOWN");first(storageCause_);if(error)*error=storageCause_;return false;}
   stored_=true;wipePublisherRegistrationBuffer(firstRecord_);firstRecord_=nil;return true;
  }@catch(NSException*){if(!storageCause_)storageCause_=failure(@"PUBLISHER_GENERATION_STORAGE_EXCEPTION_UNKNOWN");first(storageCause_);if(error)*error=storageCause_;return false;}@finally{saving_=false;}
 }
 public:
 NSData*copyOriginalPublic()const{return firstPublic_?[NSData dataWithBytes:firstPublic_.bytes length:firstPublic_.length]:nil;}
 NSDictionary*status()const{return @{@"selected":@(selected_),@"effectEntered":@(entered_),@"hasGeneratedResult":@(firstPublic_!=nil),@"resultStored":@(stored_),@"privateResultPending":@(firstRecord_!=nil),@"firstCausePresent":@(firstCause_!=nil),@"storageCausePresent":@(storageCause_!=nil),@"cabiStatus":[NSString stringWithFormat:@"%d",status_],@"cabiCleanup":[NSString stringWithFormat:@"%u",cleanup_],@"dataOnly":@YES,@"authorized":@NO,@"registered":@NO,@"retryAuthorized":@NO};}
 // A failed save keeps the same private result alive in its owning process;
 // normal close cannot discard it. Crash recovery reads the original store;
 // durable intent without a result remains UNKNOWN and refuses generation.
 bool close(NSError**error){if(error)*error=nil;if(busy_||saving_||(firstRecord_&&!stored_)||(entered_&&cleanup_!=YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1&&cleanup_!=YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1)){if(error)*error=storageCause_?:failure(@"PUBLISHER_GENERATION_RESULT_OR_CLEANUP_PENDING");return false;}closed_=true;return true;}
};
}
