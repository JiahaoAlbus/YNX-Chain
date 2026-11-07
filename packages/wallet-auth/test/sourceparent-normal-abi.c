#include "SourceParentProfileCPrivate.h"
#include <stddef.h>
_Static_assert(sizeof(void*)==8,"normal SourceParent targets are 64 bit");
_Static_assert(sizeof(ynx_sourceparent_profile_failure_v1)==12,"paired failure");
_Static_assert(offsetof(ynx_sourceparent_profile_failure_v1,code)==4,"code0 presence independent");
_Static_assert(sizeof(ynx_sourceparent_profile_images_v1)==104,"raw three SHA256");
_Static_assert(offsetof(ynx_sourceparent_profile_images_v1,images)==8,"version/size prefix");
_Static_assert(sizeof(ynx_sourceparent_profile_drain_v1)==16,"physical done independent");
_Static_assert(offsetof(ynx_sourceparent_profile_acquisition_v1,failure)==8,"owner first paired acquisition");
void sourceparent_abi_compile_only(void){
 ynx_sourceparent_profile_acquisition_v1(*a)(void)=ynx_sourceparent_profile_acquire_parent_original_v1;
 ynx_sourceparent_profile_acquisition_v1(*b)(void)=ynx_sourceparent_profile_acquire_core_original_v1;
 ynx_sourceparent_profile_acquisition_v1(*c)(void)=ynx_sourceparent_profile_acquire_native_original_v1;
 (void)a;(void)b;(void)c;
}
