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
};
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
