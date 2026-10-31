#pragma once
#import <Foundation/Foundation.h>
#include <node_api.h>
#include <memory>
@class YNXAuthIdentitySourceAuthority;
namespace ynx_auth_private {
class ProductDeviceV5NativeSource;
class ProductDeviceV5Factory;
// PRIVATE same-TU NAPI bridge. A returned Buffer is DATA, never a peer/Source
// qualification. Only the original Source's release-qualified fixed loader may
// supply the private SDK namespace; no JavaScript factory or setter is exported.
class ProductDeviceV5Transport final {
 struct Impl;std::shared_ptr<Impl> impl_;
 ProductDeviceV5Transport();
 friend class ProductDeviceV5NativeSource;
 friend class ProductDeviceV5Factory;
 static bool initialize(napi_env);
 static std::unique_ptr<ProductDeviceV5Transport> capture(napi_env,ProductDeviceV5NativeSource*,YNXAuthIdentitySourceAuthority* originalNativeSource,napi_value originalParent,napi_value fixedPrivateModule,napi_value originalPeer,napi_value originalContext);
 bool assertCurrent(napi_env,ProductDeviceV5NativeSource*,napi_value originalParent,napi_value originalPeer,napi_value originalContext);
 napi_value recheck(napi_env,ProductDeviceV5NativeSource*,napi_value originalParent,napi_value originalPeer,napi_value originalContext);
 // The guard keeps the immutable native body and this same transport alive for
 // the ENTIRE synchronous Core call. No public child operation exposes body.
 class BodyBorrow final {
  std::shared_ptr<Impl> owner_;NSData*__strong body_=nil;
  explicit BodyBorrow(std::shared_ptr<Impl>);friend class ProductDeviceV5Transport;
 public:
  ~BodyBorrow();const void*bytes()const;size_t length()const;NSData*dataDATA()const;
  BodyBorrow(const BodyBorrow&)=delete;BodyBorrow&operator=(const BodyBorrow&)=delete;
 };
 std::unique_ptr<BodyBorrow> borrowOriginalBody(napi_env,ProductDeviceV5NativeSource*,napi_value originalParent,napi_value originalPeer,napi_value originalContext);
 // Factory bool/borrow failures retain their exact JS cause privately without
 // leaving a pending exception that could hide an adopted partial operation.
 bool assertCurrentForFactory(YNXAuthIdentitySourceAuthority* sameNativeSource);
 std::unique_ptr<BodyBorrow> borrowOriginalBodyForFactory(YNXAuthIdentitySourceAuthority* sameNativeSource);
 NSDictionary*readonlyMetadataDATA()const;
 NSDictionary*originalBodyBindingDATA()const;
 bool bodyCapturedDATA()const;bool pendingDATA()const;bool closedDATA()const;
 bool firstCausePresentDATA()const;napi_value firstCauseDATA()const;napi_value closeCauseDATA()const;
 void retire();bool close();
public:
 ~ProductDeviceV5Transport();
 ProductDeviceV5Transport(const ProductDeviceV5Transport&)=delete;
 ProductDeviceV5Transport&operator=(const ProductDeviceV5Transport&)=delete;
};
}
