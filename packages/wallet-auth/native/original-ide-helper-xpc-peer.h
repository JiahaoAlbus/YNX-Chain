#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
// Native helper/listener only. Never accepts a user ID, path, audit bytes,
// requirement, Root, profile or caller-supplied approving callback.
// A connection peer is OS process identity, NOT Source/registry permission.
@interface YNXIDEHelperMessagePeer:NSObject
+ (BOOL)assertOriginalHelperExecutable:(NSError**)error;
+ (instancetype)acceptOriginalNodeConnection:(NSXPCConnection*)connection error:(NSError**)error;
- (BOOL)assertCurrentMessage:(NSError**)error;
- (NSString*)copyOriginalUserRegistryBase:(NSError**)error;
- (NSNumber*)copyOriginalUserIdentifier:(NSError**)error;
- (void)retire;
@end
#endif
