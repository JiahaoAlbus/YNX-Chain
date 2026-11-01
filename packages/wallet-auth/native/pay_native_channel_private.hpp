#pragma once
#include "pay_native_kernel.hpp"
#include "pay_native_source_lease_private.h"

namespace ynx::wallet::pay {
// Native-only holder boundary for P06/LINK. No public setter, Root bool,
// endpoint string, fetch callback or ordinary Core transport is accepted.
// A bridge to Go must hold that original *LocalCallerClient and its registered
// service/Unix peer/routes/current; it cannot create this from returned JSON.
class QualifiedPayChannel {
public:
 virtual ~QualifiedPayChannel()=default;
 virtual void current()=0;
 virtual void recheck()=0;
 virtual Exchange exchange(Operation,const Binding&,const std::vector<uint8_t>&original_member)=0;
 virtual void retire()=0;
 virtual void join()=0;
 virtual void close()=0;
protected:QualifiedPayChannel()=default;
};
}

// Exact normal capture point to be implemented by the P06/LINK native bridge.
// Binding is a selector AND immutable constraint, never permission. Capture
// must preserve out before any error and must select its own original fixed
// registration; there is no caller-selected path/service/UID/PID/Root argument.
extern "C" void ynx_wallet_capture_original_pay_channel_v1(
 const ynx::wallet::pay::Binding*,bool query_only,
 ynx_wallet_pay_source_lease_v1*actual_source_lease,
 std::unique_ptr<ynx::wallet::pay::QualifiedPayChannel>* out);
// Capture retains actual_source_lease before interpreting status/out. Every
// actual write ANDs ynx_wallet_pay_source_lease_current_v1(retainedCtx) with the
// original selected OS channel Current. Drop only after requests+Join drain.
// LINK/P06 never construct a SourceLease from Binding, Root/approved booleans,
// Go pointer, callback name, class name or returned packet JSON.
