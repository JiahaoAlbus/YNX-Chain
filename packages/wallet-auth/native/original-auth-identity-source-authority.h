#pragma once
#include <cstdint>
namespace ynx_auth_private {
// Retain an uncertain descriptor number as evidence, never close it again:
// a failed close may already have released/recycled that number.
struct TemporaryDescriptor {
 int fd=-1;bool selected=false,completed=false;
 bool hold(int value){if(value<0||unresolved())return false;fd=value;selected=false;completed=false;return true;}
 template<class Closer> bool closeOnce(Closer closer){
  if(selected)return completed;if(fd<0)return true;selected=true;
  completed=closer(fd)==0;if(completed)fd=-1;return completed;
 }
 bool unresolved()const{return fd>=0;}
 int identity()const{return fd;}
 bool available()const{return fd<0;}
};
// Known child custody is a join fence, not uncertain cleanup failure.
struct ChildOwnership {static bool joined(unsigned children){return children==0;}};
// Internal source-state validator: shape/current fences, never an approval.
struct SourceClock {
 std::uint64_t floor=0,generation=0;
 bool observe(std::uint64_t now,std::uint64_t issued,std::uint64_t expires,std::uint64_t head,std::uint64_t profile,bool revoked){
  if(revoked||!head||head!=profile||head<generation||now<floor||now<issued||expires<=issued||now>=expires)return false;
  floor=now;generation=head;return true;
 }
};
enum class JointPhase { reserved,unknown,committed,retired,closed };
struct JointLifecycle {
 JointPhase phase=JointPhase::reserved;bool attempted=false,cleanupSelected=false,cleanupComplete=false;
 bool enterCommit(){if(attempted||phase!=JointPhase::reserved)return false;attempted=true;phase=JointPhase::unknown;return true;}
 bool completeReadback(){if(phase!=JointPhase::unknown)return false;phase=JointPhase::committed;return true;}
 void retire(){if(phase!=JointPhase::closed)phase=JointPhase::retired;}
 bool selectCleanup(){if(cleanupSelected)return false;cleanupSelected=true;retire();return true;}
 void completedCleanup(bool completed){cleanupComplete=completed;if(completed)phase=JointPhase::closed;}
};
}
#ifdef __OBJC__
#import <Foundation/Foundation.h>
@class YNXAuthIdentityCurrentOwner;
@interface YNXAuthIdentitySourceAuthority : NSObject
+ (instancetype)acquireOriginalSource:(NSError **)error;
// Derived from actual parent app + actual runtime/node; no caller path.
+ (instancetype)acquireOriginalIDEConsumerSource:(NSError **)error;
+ (instancetype)acquireOriginalIDEParentSource:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
- (BOOL)assertAuthenticatedNativePurpose:(NSError **)error;
- (NSDictionary *)copyOriginalSelection:(NSError **)error;
- (NSNumber *)copyOriginalCurrentSequence:(NSError **)error;
// Private provisioning receiver input: exact signed public originals, DATA only.
// This never lends a current signer or authenticates a reserve request.
- (NSDictionary *)copyOriginalProvisioningPublicOriginals:(NSError **)error;
// Private original privileged Native receiver. No path/UID/Root/key/approval
// argument: target comes from actual kernel getuid and the existing registry.
// Requires the SAME independently admitted Source purpose RECEIVE; login and
// raw DATA cannot authorize installation. Exact public originals only, not a
// recovery/signing/export/transaction capability. Partial stays this owner.
- (NSDictionary *)installOriginalIDEIdentityPublicOriginals:(NSError **)error;
// Actual cold filesystem readback against THIS Source's immutable originals.
// This is DATA only, not identity/key recovery or a new Native admission.
- (NSDictionary *)copyOriginalIDEInstalledPublicOriginals:(NSError **)error;
// Private Native caller only. Returns authenticated DATA, never admission.
// The original caller owns once-selection/lifetime/HostState+entered binding;
// no caller policy, key, path, current original or clock is accepted here.
- (NSDictionary *)verifyOriginalFirstEnterWitness:(NSData *)witness
 binding:(NSDictionary *)binding requestId:(NSString *)requestId
 nonce:(NSString *)nonce error:(NSError **)error;
// Same original Source/task and independent compiled release, not a JS verifier.
- (BOOL)assertOriginalIDEIdentityProofConsumerReady:(NSData *)request error:(NSError **)error;
- (BOOL)assertOriginalIDEIdentityReceiveExecutionAvailable:(NSError **)error;
- (BOOL)verifyOriginalIDEIdentityProof:(NSData *)wire expectedRequest:(NSData *)request invocation:(NSData *)invocation error:(NSError **)error;
- (void)retire;
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
@end
// Implemented by the original R91 Native request category in the SAME image.
@interface YNXAuthIdentitySourceAuthority (OriginalIDEIdentityRequestFence)
- (BOOL)assertOriginalIDEIdentityRequestCurrent:(NSData *)request invocation:(NSData *)invocation error:(NSError **)error;
@end
#endif

