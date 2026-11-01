// PUBLIC CODE ROOT seam, test compiler only. Never add to normal Native image.
#ifndef YNX_PUBLIC_NAMESPACE_CONTROL
#error PUBLIC_NAMESPACE_TEST_ONLY
#endif
#include "pay_root_main_code_private.hpp"
#include "pay_native_namespace_bootstrap_private.hpp"
namespace {bool alive=true;}
namespace ynx::wallet::pay {
class OriginalPayMainCodeRoot final{};
MainCodeRootAcquisition acquire_original_pay_main_code_root()noexcept{return{std::make_shared<OriginalPayMainCodeRoot>(),0,{}};}
int32_t original_pay_main_code_root_current(const std::shared_ptr<OriginalPayMainCodeRoot>&)noexcept{return alive?0:1;}
int32_t read_original_pay_main_code_locator(const std::shared_ptr<OriginalPayMainCodeRoot>&,root_physical::RootMainLocator&out)noexcept{if(!alive)return 1;out={1,YNX_PUBLIC_MAIN_URI,std::string(64,'a'),1};return 0;}
int32_t read_original_pay_main_code_node_loader_locator(const std::shared_ptr<OriginalPayMainCodeRoot>&,root_physical::RootMainLocator&out)noexcept{if(!alive)return 1;out={1,YNX_PUBLIC_LOADER_URI,YNX_PUBLIC_LOADER_SHA,YNX_PUBLIC_LOADER_BYTES};return 0;}
void retire_original_pay_main_code_root(const std::shared_ptr<OriginalPayMainCodeRoot>&)noexcept{alive=false;}
int32_t close_original_pay_main_code_root(const std::shared_ptr<OriginalPayMainCodeRoot>&)noexcept{return 0;}
bool original_pay_main_code_root_closed(const std::shared_ptr<OriginalPayMainCodeRoot>&)noexcept{return true;}
}
NAPI_MODULE_INIT(){RegisterOriginalWalletMainNamespaceV1(env,exports);napi_property_descriptor method={"PUBLICborrow",nullptr,[](napi_env e,napi_callback_info)->napi_value{ynx::wallet::pay::MainNamespaceBorrow b;const auto status=ynx::wallet::pay::borrow_initialized_original_main_namespace(e,b);napi_value out;napi_get_boolean(e,status==0,&out);return out;},nullptr,nullptr,nullptr,napi_default,nullptr};napi_define_properties(env,exports,1,&method);return exports;}
