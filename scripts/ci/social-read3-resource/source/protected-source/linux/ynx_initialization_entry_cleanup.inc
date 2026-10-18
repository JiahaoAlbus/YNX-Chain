#include "ynx_initialization_final_private.h"
veil_store_status ynx_native_core_resource_initialization_lease_close_v2(
 ynx_native_core_resource_loan*p,int*remaining){
 if(!remaining)return VEIL_STORE_BOUND;*remaining=1;
 ynx_native_core_resource_loan*q=core_resource_recognized(p);if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(!q->driver)return VEIL_STORE_REQUIRED;
 veil_store_status s=ynx_native_core_resource_driver_initialization_lease_release_v1(q);
 *remaining=q->driver->initialization_write.lease_held?1:0;return s;
}
