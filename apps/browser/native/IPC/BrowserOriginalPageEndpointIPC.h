#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
// PRIVATE same-host bootstrap transport only. This method transfers the actual
// Foundation endpoint object; its completion is NOT Source/Root/Grant admission.
// Original Auth must independently qualify the registered Browser incarnation
// and genuine consumer before constructing its Source/transport child.
@protocol YNXBrowserOriginalPageEndpointIPC
- (void)acceptOriginalBrowserPageEndpoint:(NSXPCListenerEndpoint *)endpoint
                               withReply:(void (^)(void))reply;
@end
NS_ASSUME_NONNULL_END
