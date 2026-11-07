#pragma once
#include "AIMobileWorker.h"
#include "AIMobileIntentDATA.h"
#include <ReactCommon/TurboModule.h>
#include <ReactCommon/TurboModuleWithJSIBindings.h>
#include <optional>
namespace ynx::mobileai {
inline constexpr const char*moduleName="YNXOriginalAIMobileV6";
class OriginalInputCancellation final {
 std::atomic<bool>cancelled_{false};std::mutex mutex_;Failure first_{};
public:
 void cancel(Failure cause={1,closed})noexcept;
 bool cancelled()const noexcept{return cancelled_.load();}
 Failure cause()noexcept;
};
std::shared_ptr<facebook::react::TurboModule>makeOriginalAIMobileV6Module(const std::shared_ptr<facebook::react::CallInvoker>&);
void requestRetireOriginalAIMobileV6()noexcept;
bool drainOriginalAIMobileV6()noexcept; // native teardown thread, never JS/AbortSignal thread
}
