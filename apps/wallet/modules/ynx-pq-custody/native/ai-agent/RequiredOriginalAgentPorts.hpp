#pragma once
#include <MobileAITaskRuntimePrivate.h>
#include <memory>
#include <string>
#include <vector>
#include <type_traits>
namespace ynx::mobilepq::aiagent {
using Bytes=std::vector<uint8_t>;using Failure=YNXAIMobileFailureV6;
// PRIVATE Native original registered-Agent resource, not Auth key export.
// This module owns actual physical custody bodies. No callback/provider/DTO/FD
// installer, JSON key selector, or key-generation/import capability exists.
class OriginalRegisteredAgentKeyLoan;
struct ResourceAcquisition{std::shared_ptr<OriginalRegisteredAgentKeyLoan>owner;Failure failure{};};
struct ProtectedKeySpans{YNXAIMobileSpanV6 pkcs8A,pkcs8B,publicA,publicB;};
ResourceAcquisition acquireOriginalRegisteredAgentKeyForCapture(YNXAIMobileSigningCapture*)noexcept;
class OriginalRegisteredAgentKeyLoan final {
 struct State;std::shared_ptr<State>state_;
 explicit OriginalRegisteredAgentKeyLoan(std::shared_ptr<State>);
 friend ResourceAcquisition acquireOriginalRegisteredAgentKeyForCapture(YNXAIMobileSigningCapture*)noexcept;
public:
 OriginalRegisteredAgentKeyLoan(const OriginalRegisteredAgentKeyLoan&)=delete;
 OriginalRegisteredAgentKeyLoan&operator=(const OriginalRegisteredAgentKeyLoan&)=delete;
 Failure current(YNXAIMobileSigningCapture*sameCapture)noexcept;
 // Exact15 public metadata read from the independently recognized protected
 // resource and original registration, not copied from caller expected15.
 Failure copyOriginalRegistrationDATA(Bytes&)noexcept;
 // Native same-process borrowed spans. Held secret copies never cross JS, IPC
 // or DATA observation. Actual loan owns wipe until true releaseClosed.
 Failure borrowForOriginalFixedSign(YNXAIMobileSigningCapture*sameCapture,ProtectedKeySpans&)noexcept;
 void retire()noexcept;
 Failure join()noexcept;Failure close()noexcept;bool isClosed()const noexcept;
 Failure releaseClosed()noexcept;
};
// Original sole/Auth fixed math body, not Core Source18/N1 verification nor an
// alias to Tx/account/IDE signing. No selectable purpose/domain/provider/rng.
struct FixedSignRequest {
 uint32_t version=6;size_t size=sizeof(FixedSignRequest);
 YNXAIMobileSpanV6 unsignedOriginal,messageOriginal,networkHex,keyEpoch;
 YNXAIMobileSpanV6 publicA,publicB,pkcs8A,pkcs8B;
};
static_assert(std::is_standard_layout<FixedSignRequest>::value,"fixed AI sign request must retain C-compatible field layout");
#if INTPTR_MAX == INT64_MAX
static_assert(sizeof(FixedSignRequest)==144 && offsetof(FixedSignRequest,unsignedOriginal)==16 && offsetof(FixedSignRequest,pkcs8B)==128,"fixed AI arm64 ABI differs from the sole C request");
#endif
int32_t signOriginalAITaskActionV6(const FixedSignRequest&,uint8_t*member,size_t capacity,size_t*length,uint32_t*cleanup)noexcept;
}
