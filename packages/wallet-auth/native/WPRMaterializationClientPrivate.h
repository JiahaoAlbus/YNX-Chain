#pragma once
#import "WPRMaterializationRPCPrivate.h"
// Native NodeHost OWNED client, not a JS/provider object or a serialized ptr.
// Original addon binds fixed methods; no runtime peer/path/row/UID setters.
@interface YNXWPRMaterializationClientPrivate:NSObject
+ (instancetype)acquireOriginal:(NSError**)error;
- (NSDictionary*)readCapturedPublicOriginals:(NSError**)error;
- (NSDictionary*)readIndependentMaterializationOriginals:(NSError**)error;
- (BOOL)assertCurrent:(NSError**)error;
- (BOOL)recheck:(NSError**)error;
- (void)retire;
- (BOOL)join:(NSError**)error;
- (BOOL)close:(NSError**)error;
- (BOOL)isClosed;
- (BOOL)errorPresent;
- (NSError*)firstCause;
@end
