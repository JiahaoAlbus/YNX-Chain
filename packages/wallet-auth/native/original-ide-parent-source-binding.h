#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import "original-auth-identity-source-authority.h"
#include <mutex>

namespace ynx_auth_ide_private {
// Only an already authenticated original Source may supply registration.
// This private profile projection adds no issuer, signing purpose or frame.
// It is not accepted from JS, paths, ENV, fd metadata or a receipt alone.
class SourceBinding final {
 YNXAuthIdentitySourceAuthority *__strong source_=nil;
 NSDictionary *__strong selection_=nil,*request_=nil,*registration_=nil;
 NSError *__strong first_=nil;
 bool selected_=false,invalid_=false;
 std::recursive_mutex mutex_;
 bool fail(NSString *,NSError **);
public:
 bool capture(YNXAuthIdentitySourceAuthority *originalSource,NSError **);
 bool current(NSError **);
 NSNumber *currentSequence(NSError **);
 NSDictionary *request()const{return request_;}
 NSDictionary *registration()const{return registration_;}
 NSDictionary *selection()const{return selection_;}
};
}
#endif
