#include "OriginalServices.hpp"
#include "social_joint_profile_issuer_private.h"

namespace ynx::social::joint::original {
void selectOriginalMainPairRoute(Source&source,std::uint32_t&out,
 std::uint64_t&loan_out,Result&r)noexcept {
 out=0;loan_out=0;std::uint64_t loan=0;
 r=borrowCapturedSourceLoan(source,loan);if(!r.ok())return;
 if(!loan){r={true,-41401,false,false};return;}
 std::uint32_t route=0;ynx_social_joint_status_v1 s{};
 ynx_auth_social_joint_capture_borrow_main_pair_route_v1(loan,&route,&s);
 // A valid copied selector remains DATA even with a late original failure.
 if(route==1||route==2)out=route;
 if(s.version!=1||s.size!=sizeof(s)||s.error_present>1||s.unknown>1||
    s.physical_done||(!s.error_present&&s.original_first)){r={true,-41402,true,false};return;}
 r={s.error_present!=0,s.original_first,s.unknown!=0,false};
 if(r.ok()&&!out)r={true,-41401,false,false};
 if(r.ok())r=source.current();
 if(r.ok())loan_out=loan;
}
} // namespace ynx::social::joint::original
