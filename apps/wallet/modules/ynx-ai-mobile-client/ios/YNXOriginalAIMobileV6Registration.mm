#include "YNXOriginalAIMobileV6Registration.h"
#include "AIMobileBinding.h"
#include <ReactCommon/CxxTurboModuleUtils.h>
#include <mutex>
void YNXOriginalAIMobileV6RegisterBeforeReactHost(void){
 static std::once_flag once;
 std::call_once(once,[]{facebook::react::registerCxxModuleToGlobalModuleMap(ynx::mobileai::moduleName,ynx::mobileai::makeOriginalAIMobileV6Module);});
}
void YNXOriginalAIMobileV6RequestRetireBeforeHostInvalidation(void){ynx::mobileai::requestRetireOriginalAIMobileV6();}
bool YNXOriginalAIMobileV6DrainOnNativeTeardownExecutor(void){return ynx::mobileai::drainOriginalAIMobileV6();}
