#pragma once
#import <Foundation/Foundation.h>
#include <sys/types.h>

// PRIVATE storage DATA/custody, not Source admission or a new namespace schema.
// Values must be obtained from the original owning backend by the separately
// qualified Native composition. This API cannot select or approve a Root row.
struct YNXIDEOriginalSessionStoreReference {
 NSString *service;
 NSString *baseKey;
 NSString *existingLockPath;
 dev_t lockDevice;
 ino_t lockInode;
 uid_t ownerUID;
 gid_t ownerGID;
};

@interface YNXIDEOriginalSessionStoreRead : NSObject
// No create/migrate/restore/write operation exists. Opening an existing lock
// never creates it. nonnil + error is the SAME cleanup partial; adopt first.
+ (instancetype)holdOriginal:(const YNXIDEOriginalSessionStoreReference &)reference error:(NSError **)error;
- (BOOL)assertCurrent:(NSError **)error;
// Only original base and original :revoke are exposed. Revocation/UNKNOWN is
// retained, never fabricated as absent. Other keys fail without reading.
- (NSString *)readOriginal:(NSString *)key error:(NSError **)error;
- (BOOL)revocationRequested;
- (void)retire;
- (BOOL)join:(NSError **)error;
- (BOOL)close:(NSError **)error;
@property(nonatomic,readonly) BOOL closed;
@property(nonatomic,readonly) NSError *firstCause;
@end
