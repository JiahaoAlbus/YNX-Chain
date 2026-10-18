/* Same original driver TU; no public installer, callback or DTO authority. */
static veil_store_status core_final_finish_check(ynx_native_core_resource_loan*q,
 veil_native_finish_result*finish,int qualified){
 core_domain_driver*d=q->driver;
 if(!d||!d->engine_committed||!d->engine_finish)return VEIL_STORE_REQUIRED;
 if(finish&&d->engine_finish!=finish)return VEIL_STORE_MISMATCH;
 veil_store_status s=core_engine_current(q);
 if(!s)s=core_store_open(q);
 unsigned char raw[416];size_t n=0;
 if(!s)s=core_engine_read(q,raw,sizeof(raw),&n);
 if(!s&&n!=sizeof(raw))s=VEIL_STORE_MISMATCH;
 if(!s&&qualified)s=core_m3_qualified_current_inner(q);
 OPENSSL_cleanse(raw,sizeof(raw));return s;
}
veil_store_status ynx_native_core_resource_driver_committed_finish_borrow(
 ynx_native_core_resource_loan*p,veil_native_finish_result**out){
 if(!out||*out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 s=core_driver_fence_enter(q,0);if(!s)s=core_final_finish_check(q,NULL,0);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 /* Publish only after the independent readback and fence leave both succeed. */
 if(!s&&!q->unknown)*out=q->driver->engine_finish;
 q->active=0;return q->unknown?VEIL_STORE_UNKNOWN:s;
}
static veil_store_status core_final_validate(ynx_native_core_resource_loan*p,
 veil_native_finish_result*finish,int retain){
 if(!finish)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 s=core_driver_fence_enter(q,0);if(!s)s=core_final_finish_check(q,finish,1);
 if(!s&&retain&&q->final_borrows>=32)s=VEIL_STORE_BOUND;
 if(!s&&!retain&&!q->final_borrows)s=VEIL_STORE_BOUND;
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(!s&&!q->unknown&&retain)q->final_borrows++;
 q->active=0;return q->unknown?VEIL_STORE_UNKNOWN:s;
}
veil_store_status ynx_native_core_resource_driver_final_retain(
 ynx_native_core_resource_loan*p,veil_native_finish_result*f){return core_final_validate(p,f,1);}
veil_store_status ynx_native_core_resource_driver_final_current(
 ynx_native_core_resource_loan*p,veil_native_finish_result*f){return core_final_validate(p,f,0);}
veil_store_status ynx_native_core_resource_driver_final_release(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=core_resource_recognized(p);
 if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 /* Cleanup remains available after expiry/revoke/UNKNOWN; never enters effect. */
 if(q->active)return core_resource_fail(q,VEIL_STORE_FROZEN);
 if(!q->final_borrows)return VEIL_STORE_BOUND;q->final_borrows--;return VEIL_STORE_OK;
}
