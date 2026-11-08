// SAME RootCapture TU/private inventory. No Source/callback/Root installer.
// Independent pending purpose + fixed pending evaluator, not old3 promotion.
static std::vector<B*>pendingFields(ynx_auth_android_pending_review_data_v1&v){return{&v.scope_original,&v.registration_original,&v.request_original,&v.challenge_original,&v.pending_id,&v.registration_digest,&v.request_digest,&v.approval_digest,&v.source_id,&v.instance_id,&v.source_generation,&v.stable_device_identity,&v.device_generation,&v.account,&v.product_id,&v.client_id,&v.application_id,&v.bundle_id,&v.package_id,&v.origin,&v.callback,&v.device_id};}
static bool pendingEqual(ynx_auth_android_pending_review_data_v1&a,ynx_auth_android_pending_review_data_v1&b){if(a.kind!=b.kind||a.null_mask!=b.null_mask||a.not_before_ms!=b.not_before_ms||a.expires_at_ms!=b.expires_at_ms||std::memcmp(a.network,b.network,32)||std::memcmp(a.canonical_owner,b.canonical_owner,42)||std::memcmp(a.device_pk_a,b.device_pk_a,2592)||std::memcmp(a.device_pk_b,b.device_pk_b,64))return false;auto x=pendingFields(a),y=pendingFields(b);for(size_t i=0;i<x.size();i++)if(x[i]->length!=y[i]->length||(x[i]->length&&std::memcmp(x[i]->bytes,y[i]->bytes,x[i]->length)))return false;return true;}
static void collectPendingProjection(Captured&c){Bytes storage(YNX_AUTH_ANDROID_EVALUATOR_OUTPUT_MAX_V1);ynx_auth_android_pending_projection_data_v1 projected{};F f{};
 {Borrow b(c);ynx_auth_android_device_evaluator_copy_pending_projection_v1(c.evaluator,reinterpret_cast<ynx_auth_android_device_capture_v1*>(c.token),storage.data(),storage.size(),&projected,&f);}c.retained_projection=storage;if(bad(f))throw f;
 auto&v=projected.review;if(projected.version!=1||projected.size!=sizeof(projected)||v.version!=1||v.size!=sizeof(v)||v.kind<1||v.kind>2||v.reserved||v.app_reserved||(v.null_mask&~3u)||v.not_before_ms<0||v.expires_at_ms<=v.not_before_ms)throw 2;
 for(auto*p:pendingFields(v))(void)copied(*p,storage,true);
 // The sole typed object owns generation/owner/application/null semantics.
 // No CPP JSON parser, deviceId-derived stable identity, namespace or issuer.
 if(v.stable_device_identity.length||v.request_digest.length)throw 2;
 if(!v.scope_original.length||v.scope_original.length>65536||!v.registration_original.length||v.registration_original.length>16384||!v.request_original.length||v.request_original.length>16384||v.challenge_original.length>16384||(v.kind==1&&v.challenge_original.length)||(v.kind==2&&!v.challenge_original.length))throw 2;
 const auto generation=copied(v.device_generation,storage),sourceGeneration=copied(v.source_generation,storage),owner=std::string(reinterpret_cast<const char*>(v.canonical_owner),42);
 if(!ac::canonical_device_generation(generation)||!ac::canonical_device_generation(sourceGeneration)||!ac::canonical_owner(owner)||copied(v.source_id,storage).empty()||copied(v.instance_id,storage).empty())throw 2;
 auto previous=copied(projected.previous_canonical,storage);if(previous.size()>4096)throw 2;
 auto expiry=std::min(v.expires_at_ms,c.wall_anchor+c.row->maximum_capture_ms);if(c.expiry)expiry=std::min(expiry,c.expiry);v.expires_at_ms=expiry;
 if(c.snapshot_set&&!pendingEqual(c.pending,v))throw 6;
 c.pending=v;c.pending_storage=std::move(storage);c.pending_previous=previous;c.previous=previous;c.not_before=v.not_before_ms;c.expiry=expiry;c.snapshot_set=true;
 physical(c);c.qualified=true;
}
