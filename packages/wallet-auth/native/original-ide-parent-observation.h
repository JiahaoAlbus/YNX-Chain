#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import <mach/message.h>
#include "original-ide-parent-lifetime.h"

namespace ynx_auth_ide_private {
// Observations only. Construction is NOT Source/joint admission. A caller
// cannot use this class or its BOOL results as an authorized parent guard.
class Observation final {
 struct Impl;
 Impl *p_;
public:
 Observation();
 Observation(const Observation&)=delete;
 Observation& operator=(const Observation&)=delete;
 ~Observation();
 bool captureActualIDE(NSError **error);
 bool assertOriginals(NSError **error);
 bool captureActualSpawnedNode(pid_t actualPID,NSError **error);
 bool assertActualSpawnedNode(NSError **error);
 const ProcessOriginal& wallet()const;
 const ProcessOriginal& ide()const;
 const ProcessOriginal& node()const;
 const audit_token_t& ideAuditToken()const;
 const audit_token_t& walletPeerAuditToken()const;
 int ownedEndpoint()const;
 NSString *actualResources()const;
 NSData *walletCodeIdentity()const;
 NSData *ideCodeIdentity()const;
 bool retireEndpoint(NSError **error);
 // Factory calls only after authenticated original pending prelude. This takes
 // IDE-process inherited fd4, never the distinct Node-process JS Socket fd4.
 bool takeInheritedEndpoint(NSError **error);
 bool closeOnce(NSError **error);
};
}
#endif
