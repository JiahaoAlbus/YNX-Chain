#pragma once
#include "DeviceV4SourceBorrowPrivate.h"
#include <memory>
#include <array>
#include <vector>
namespace ynx::auth::devicev4 {
using Failure=ynx_auth_device_v4_failure_v1;
using Drain=ynx_auth_device_v4_drain_v1;
using Bytes=std::vector<uint8_t>;
// Private DATA emitted only downstream of the original full Source-v2 math.
// It is not inserted into public expected17/context12 or a signed Source body.
struct AccountNamespace {Bytes issuer,subject,sourceId,instanceId;uint64_t generation=0;bool present=false;bool operator==(const AccountNamespace&o)const{return issuer==o.issuer&&subject==o.subject&&sourceId==o.sourceId&&instanceId==o.instanceId&&generation==o.generation&&present==o.present;}};
struct Snapshot {std::array<Bytes,17>expected;uint32_t nullMask=0;Bytes context,registration,session;int64_t issued=0,expires=0;AccountNamespace accountNamespace;};
// Final direct original backend; not caller-subclassable or installable.
class Backend final {
 struct Impl;std::unique_ptr<Impl>p_;
 Backend();friend struct BackendFactory;
public:
 ~Backend();Backend(const Backend&)=delete;
 Failure current()noexcept;Failure snapshot(Snapshot&)noexcept;
 Drain join()noexcept;Drain close()noexcept;
};
struct BackendAcquisition{std::shared_ptr<Backend>owner;Failure failure{};};
BackendAcquisition acquireOriginalBackend()noexcept;
// Fixed private native path: reserve custody BEFORE invoking a real backend.
ynx_auth_device_v4_acquisition_v1 reserveOriginalNativeOwner()noexcept;
ynx_auth_device_v4_acquisition_v1 completeOriginalNativeOwner(ynx_auth_device_v4_source_v1*,BackendAcquisition)noexcept;
uint64_t wallNow()noexcept;uint64_t monoNow()noexcept;
Failure localFailure(int32_t)noexcept;
enum Code:int32_t{NotSupplied=73001,Arguments,WrongActor,Retired,Pending,Capacity,Changed,Expired,ClockRollback,Exception,Closed,Reference,Unavailable};
}
