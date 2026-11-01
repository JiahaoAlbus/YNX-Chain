#pragma once
#include "pay_root_postbuild_private.hpp"
#include <memory>
namespace ynx::wallet::pay {
// Independent code/namespace Root only. Deliberately NOT OriginalRootSource;
// it cannot satisfy Native SourceLease's operational Root holder parameter.
class OriginalPayMainCodeRoot;
struct MainCodeRootAcquisition {std::shared_ptr<OriginalPayMainCodeRoot>owner;int32_t error;std::string cause;};
MainCodeRootAcquisition acquire_original_pay_main_code_root()noexcept;
int32_t original_pay_main_code_root_current(const std::shared_ptr<OriginalPayMainCodeRoot>&)noexcept;
int32_t read_original_pay_main_code_locator(const std::shared_ptr<OriginalPayMainCodeRoot>&,root_physical::RootMainLocator&)noexcept;
int32_t read_original_pay_main_code_node_loader_locator(const std::shared_ptr<OriginalPayMainCodeRoot>&,root_physical::RootMainLocator&)noexcept;
void retire_original_pay_main_code_root(const std::shared_ptr<OriginalPayMainCodeRoot>&)noexcept;
int32_t close_original_pay_main_code_root(const std::shared_ptr<OriginalPayMainCodeRoot>&)noexcept;
bool original_pay_main_code_root_closed(const std::shared_ptr<OriginalPayMainCodeRoot>&)noexcept;
}
