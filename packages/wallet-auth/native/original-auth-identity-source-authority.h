#pragma once
#include <cstdint>
namespace ynx_auth_private {
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
- (BOOL)assertCurrent:(NSError **)error;
- (BOOL)assertAuthenticatedNativePurpose:(NSError **)error;
- (NSDictionary *)copyOriginalSelection:(NSError **)error;
- (void)retire;
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
@end
#endif
