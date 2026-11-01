#pragma once
#include <node_api.h>
#include <memory>
#include "pay_native_startup_epoch_private.hpp"
namespace ynx::wallet::pay {
class OriginalPayMainCodeRoot;
// Private short borrow, SAME env actor/current call only. No public installer,
// namespace argument, path, provider, or Root construction is exposed to JS.
struct MainNamespaceBorrow {napi_value original=nullptr;std::shared_ptr<OriginalPayMainCodeRoot>code_root;std::shared_ptr<NativeStartupEpoch>epoch;};
int32_t borrow_initialized_original_main_namespace(napi_env,MainNamespaceBorrow&)noexcept;
}
extern "C" napi_value RegisterOriginalWalletMainNamespaceV1(napi_env,napi_value);
