#pragma once
#import <Foundation/Foundation.h>

// Private native storage ONLY. No Node exports, authority factory, generic
// signing callback, asset vault or secret-export UI. Actual Source/current
// publisher registry and independent approval must gate the owning effect.
// This class does not create keys or establish historical key-purpose trust.
@interface YNXOriginalArtifactPublisherStore : NSObject
// One Data Protection Keychain item encrypts the full R + KEY7 custody record
// together. Create-only; duplicate/uncertain results never cause replacement.
- (BOOL)createOriginalRecord:(NSData *)record
         forPublicOriginal:(NSData *)publicOriginal
                     error:(NSError **)error;
// Protected-process plaintext only. Caller must wipe the returned mutable
// bytes after purpose-specific SDK import. Never expose through IPC or logs.
- (NSMutableData *)copyOriginalRecordForPublicOriginal:(NSData *)publicOriginal
                                                error:(NSError **)error;
@end
