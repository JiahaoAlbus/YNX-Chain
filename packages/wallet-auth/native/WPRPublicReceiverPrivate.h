#pragma once
#import "WPRPublicationSourcePrivate.h"
@interface YNXWPRPublicReceiver:NSObject
+ (instancetype)acquireForOriginalPeer:(YNXWPRPublicationPeer*)peer error:(NSError**)error;
- (NSDictionary*)publishOriginal:(NSError**)error;
- (NSDictionary*)copyOriginalReadBack:(NSError**)error;
- (NSDictionary*)copyRetainedReceiptDATA;
- (void)retire;
- (BOOL)join:(NSError**)error;
- (BOOL)close:(NSError**)error;
- (BOOL)physicallyClosed;
@end
