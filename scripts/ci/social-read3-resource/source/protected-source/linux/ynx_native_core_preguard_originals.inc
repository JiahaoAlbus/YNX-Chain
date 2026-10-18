/* Same original resource TU. Lifetime counts do not authorize a prepared
 * native store. Admission/lease/intent must additionally retain actual verified
 * Source/account/prepared producers, never public binding/ServerCoreFacts. */
static veil_store_status core_prepared_validate(ynx_native_core_resource_loan*p,
 void*policy,ynx_native_core_resource_loan**out,int retaining){
 if(!policy||!out||*out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 if(q->policy!=policy)s=VEIL_STORE_MISMATCH;
 if(!s&&(!q->participant||!q->row||!q->driver))s=VEIL_STORE_REQUIRED;
 if(!s&&!retaining&&!q->prepared_borrows)s=VEIL_STORE_BOUND;
 if(!s&&retaining&&q->prepared_borrows>=32)s=VEIL_STORE_BOUND;
 int checked=0;
 if(!s){checked=1;s=core_driver_fence_enter(q,0);}
 if(!s)s=core_driver_policy(q);
 if(!s)s=ynx_native_core_participant_current(q->participant);
 /* Real selected DB identity/current/schema; no CREATE, environment path,
  * bare SQLite mutex or post-M3 final qualification grants entry here. */
 if(!s)s=core_store_open(q);
 if(!s)s=core_driver_policy(q);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(!s&&!q->unknown){if(retaining)q->prepared_borrows++;*out=q;}
 if(s&&checked)s=core_resource_fail(q,s);
 q->active=0;return q->unknown?VEIL_STORE_UNKNOWN:s;
}
veil_store_status ynx_native_core_resource_driver_prepared_retain(
 ynx_native_core_resource_loan*p,void*policy){
 ynx_native_core_resource_loan*q=NULL;return core_prepared_validate(p,policy,&q,1);
}
veil_store_status ynx_native_core_resource_driver_prepared_current(
 ynx_native_core_resource_loan*p,void*policy){
 ynx_native_core_resource_loan*q=NULL;return core_prepared_validate(p,policy,&q,0);
}
veil_store_status ynx_native_core_resource_driver_prepared_originals_borrow(
 ynx_native_core_resource_loan*p,void*policy,
 const ynx_native_core_participant_originals_v2**out){
 if(!out||*out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_prepared_validate(p,policy,&q,0);
 if(!s)*out=&q->participant->originals;return s;
}
veil_store_status ynx_native_core_resource_driver_prepared_store_borrow(
 ynx_native_core_resource_loan*p,void*policy,const char**path,
 uint64_t*device,uint64_t*inode){
 if(!path||*path||!device||!inode)return VEIL_STORE_BOUND;*device=0;*inode=0;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_prepared_validate(p,policy,&q,0);
 if(!s){if(!q->row->store||q->row->store[0]!='/'||!q->row->store_device||!q->row->store_inode)return core_resource_fail(q,VEIL_STORE_MISMATCH);
  *path=q->row->store;*device=q->row->store_device;*inode=q->row->store_inode;}
 return s;
}
veil_store_status ynx_native_core_resource_driver_prepared_release(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=core_resource_recognized(p);
 if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 /* Cleanup only: no permission/current check after expiry or UNKNOWN. */
 if(q->active)return core_resource_fail(q,VEIL_STORE_FROZEN);
 if(!q->prepared_borrows)return VEIL_STORE_BOUND;q->prepared_borrows--;return VEIL_STORE_OK;
}
