#include <PendingMainCalleePrivate.h>
namespace {
using F=ynx_auth_android_provision_failure_v1;
constexpr uint32_t origin=0x4e504142;
F error(int32_t code){return{1,code,origin,0};}
bool valid(F f){return f.present<=1&&(f.present||(!f.code&&!f.origin&&!f.platform_code));}
F checked(F f){return valid(f)?f:error(2);}
}
// The SAME Main raw opaque context is captured and closed by the original
// zero-input Main factory/caller. Native creates no second context inventory,
// first-call actor brand, deadline, Weak owner, JSON/JS signal or Root source.
extern "C" void ynx_original_android_pending_abort_current_v1(ynx_original_android_abort_context_v1*context,F*out){
 if(!out)return;*out=error(2);if(!context)return;F observed=error(8);
 try{ynx_main_android_pending_original_abort_current_v1(context,&observed);*out=checked(observed);}
 catch(...){*out=!valid(observed)?error(2):(observed.present?observed:error(8));}
}
