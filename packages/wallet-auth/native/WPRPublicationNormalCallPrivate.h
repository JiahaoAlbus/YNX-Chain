#pragma once
#import "WPRPublicReceiverPrivate.h"
typedef NS_ENUM(uint32_t,YNXWPRPublicationAction){YNXWPRPublishOriginal=1,YNXWPRReadOriginal=2};
// Retain receiver before inspecting first error or physicalDone. No installer
// paths, UID, Root material, arbitrary method or callback input is accepted.
@interface YNXWPRPublicationCall:NSObject
@property(nonatomic,strong,readonly)YNXWPRPublicReceiver*receiver;
@property(nonatomic,strong,readonly)NSDictionary*originalReceiptDATA;
@property(nonatomic,strong,readonly)NSError*firstError;
@property(nonatomic,readonly)BOOL physicalDone;
+ (instancetype)runOriginalPeer:(YNXWPRPublicationPeer*)peer action:(YNXWPRPublicationAction)action;
// SAME owner bounded cleanup only. Never reacquires Source or restarts effect.
- (BOOL)drainOriginal;
@end
