package main

/*
#include <stdlib.h>
#include <string.h>
#include "auth_source_statement_v2.h"

// A real C caller compiled against the hand header, invoking the actual export.
// Public synthetic DATA only. No alternative verifier or signature generator.
static int source_v2_foreign_controls(YNXAuthSourceStatementVerifyRequestV2 *r) {
 YNXRegisteredANDMemberVerifyN1ResultV1 out;
 memset(&out,0x5a,sizeof out);
 if(YNXAuthSourceStatementVerifyV2(r,&out)!=0 || out.version!=1 || out.struct_size!=32 || out.verified!=1 || out.member_count!=1 || out.index || out.cleanup_status || out.reserved) return 1;
 if(YNXAuthSourceStatementVerifyV2(NULL,&out)!=1 || YNXAuthSourceStatementVerifyV2(r,NULL)!=1) return 2;
 YNXAuthSourceStatementVerifyRequestV2 bad=*r;
 bad.version=2;memset(&out,0x5a,sizeof out);
 if(YNXAuthSourceStatementVerifyV2(&bad,&out)!=1 || out.version!=1 || out.struct_size!=32 || out.verified || out.member_count || out.index || out.cleanup_status || out.reserved) return 3;
 bad=*r;bad.reserved=1;if(YNXAuthSourceStatementVerifyV2(&bad,&out)!=1) return 4;
 bad=*r;bad.role=4;if(YNXAuthSourceStatementVerifyV2(&bad,&out)!=1) return 5;
 bad=*r;bad.struct_size--;if(YNXAuthSourceStatementVerifyV2(&bad,&out)!=1) return 6;
 const YNXReadOnlyPublicSpanV1 spans[]={r->member,r->body_original,r->expected_frame,r->network,r->owner,r->pk_a,r->pk_b};
 for(int i=0;i<7;i++) {
  // Allocations are real; no fake address is dereferenced. Alias checks must
  // finish before initializing the result or touching borrowed public bytes.
  uint8_t before[32];size_t n=spans[i].bytes<32?spans[i].bytes:32;
  memcpy(before,spans[i].data,n);
  if(YNXAuthSourceStatementVerifyV2(r,(YNXRegisteredANDMemberVerifyN1ResultV1*)spans[i].data)!=1 || memcmp(before,spans[i].data,n)) return 10+i;
 }
 YNXAuthSourceStatementVerifyRequestV2 saved=*r;
 if(YNXAuthSourceStatementVerifyV2(r,(YNXRegisteredANDMemberVerifyN1ResultV1*)r)!=1 || memcmp(&saved,r,sizeof saved)) return 20;
 bad=*r;bad.member.data=NULL;if(YNXAuthSourceStatementVerifyV2(&bad,&out)!=1) return 21;
 bad=*r;bad.body_original.bytes=65537;if(YNXAuthSourceStatementVerifyV2(&bad,&out)!=1) return 22;
 bad=*r;bad.member.bytes=262145;if(YNXAuthSourceStatementVerifyV2(&bad,&out)!=1) return 23;
 bad=*r;bad.expected_frame.bytes=513;if(YNXAuthSourceStatementVerifyV2(&bad,&out)!=1) return 24;
 return 0;
}
*/
import "C"
import "unsafe"

func sourceStatementV2ForeignControls(in sourceStatementV2Inputs) int {
	var allocations []unsafe.Pointer
	span := func(b []byte) C.YNXReadOnlyPublicSpanV1 {
		p := C.CBytes(b)
		allocations = append(allocations, p)
		return C.YNXReadOnlyPublicSpanV1{data: (*C.uint8_t)(p), bytes: C.uint64_t(len(b))}
	}
	defer func() {
		for _, p := range allocations {
			C.free(p)
		}
	}()
	r := C.YNXAuthSourceStatementVerifyRequestV2{version: 1, struct_size: 176, role: C.uint32_t(in.role),
		member: span(in.registration.member), body_original: span(in.body), expected_frame: span([]byte(in.frame)), network: span(in.registration.network), owner: span([]byte(in.registration.owner)), pk_a: span(in.registration.pkA), pk_b: span(in.registration.pkB),
		key_version: C.uint64_t(in.registration.policyRevision), issued_height: C.uint64_t(in.issuedHeight), observed_height: C.uint64_t(in.registration.observedHeight), active_from: C.uint64_t(in.registration.activeFrom), revoked_at: C.uint64_t(in.registration.revokedAt), enabled: C.uint32_t(in.registration.enabled), has_revoked_at: C.uint32_t(in.registration.hasRevokedAt)}
	return int(C.source_v2_foreign_controls(&r))
}
