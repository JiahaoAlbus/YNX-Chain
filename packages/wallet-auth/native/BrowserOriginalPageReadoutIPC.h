#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
// Production native transport selector. Request and response are the unchanged P08
// YNX_AI_BROWSER_PAGE_READ_REQUEST_V1 and P05 selected-page readout DATA.
// An endpoint/code requirement is not a Source/Root/Grant registration.
@protocol YNXBrowserOriginalPageReadoutIPC
- (void)readOriginalBrowserPageReadout:(NSData *)request
                          withReply:(void (^)(NSData * _Nullable, NSString * _Nullable))reply;
@end
NS_ASSUME_NONNULL_END
