package main

/*
#include <stdlib.h>
#include <string.h>
#include "network_resource_consent.h"
static void resource_wipe(void *p,size_t n){volatile unsigned char *b=(volatile unsigned char*)p;while(n--)*b++=0;}
static YNXNetworkResourceConsentRequestV1 resource_action(uint32_t action,uint64_t handle){YNXNetworkResourceConsentRequestV1 r={0};r.abi_version=1;r.struct_size=sizeof(r);r.action=action;r.handle=handle;return r;}
static int resource_foreign_controls(YNXNetworkResourceConsentRequestV1 *prepare,YNXNetworkResourceConsentRequestV1 *sign,uint8_t *buffer,size_t *saved_length){
 YNXNetworkResourceConsentResultV1 out,dirty;memset(&dirty,0x5a,sizeof dirty);out=dirty;
 if(sizeof(*prepare)!=264 || sizeof(out)!=40) return 1;
 if(YNXNetworkResourceConsentAttemptV1(NULL,NULL,0,&out)!=1 || memcmp(&out,&dirty,sizeof out))return 2;
 if(YNXNetworkResourceConsentAttemptV1(prepare,NULL,0,NULL)!=1)return 3;
 YNXNetworkResourceConsentRequestV1 bad=*prepare;bad.abi_version=2;
 if(YNXNetworkResourceConsentAttemptV1(&bad,NULL,0,&out)!=1 || memcmp(&out,&dirty,sizeof out))return 4;
 bad=*prepare;bad.struct_size--;
 if(YNXNetworkResourceConsentAttemptV1(&bad,NULL,0,&out)!=1)return 5;
 const YNXNetworkResourceBytesV1 inputs[]={prepare->scope_original,prepare->input_original,prepare->expected.network_id,prepare->expected.owner,prepare->expected.key_epoch,prepare->expected.issued_height,prepare->expected.pk_a,prepare->expected.pk_b,prepare->current.subject_owner,prepare->current.policy_original};
 for(int i=0;i<10;i++){unsigned char before[40];memcpy(before,inputs[i].bytes,40);if(YNXNetworkResourceConsentAttemptV1(prepare,NULL,0,(YNXNetworkResourceConsentResultV1*)inputs[i].bytes)!=3 || memcmp(before,inputs[i].bytes,40))return 10+i;}
 YNXNetworkResourceConsentRequestV1 original=*prepare;
 if(YNXNetworkResourceConsentAttemptV1(prepare,NULL,0,(YNXNetworkResourceConsentResultV1*)prepare)!=3 || memcmp(&original,prepare,sizeof original))return 21;
 bad=*prepare;bad.input_original.bytes=NULL;
 if(YNXNetworkResourceConsentAttemptV1(&bad,NULL,0,&out)!=2)return 22;
 bad=*prepare;bad.expected.pk_b.bytes=(const uint8_t*)(UINTPTR_MAX-8);
 if(YNXNetworkResourceConsentAttemptV1(&bad,NULL,0,&out)!=2)return 23;
 if(YNXNetworkResourceConsentAttemptV1(prepare,NULL,0,&out)!=0 || !out.handle || out.member_length || out.cleanup_status!=1 || out.flags!=128)return 24;
 uint64_t handle=out.handle;sign->handle=handle;
 out=dirty;if(YNXNetworkResourceConsentAttemptV1(sign,buffer,262143,&out)!=4 || memcmp(&out,&dirty,sizeof out))return 25;
 out=dirty;if(YNXNetworkResourceConsentAttemptV1(sign,buffer,262145,&out)!=4 || memcmp(&out,&dirty,sizeof out))return 26;
 bad=*sign;bad.pkcs8_a.bytes=sign->pk_a.bytes;
 if(YNXNetworkResourceConsentAttemptV1(&bad,buffer,262144,&out)!=3)return 27;
 bad=*sign;bad.pkcs8_b.bytes=(const uint8_t*)&bad;
 if(YNXNetworkResourceConsentAttemptV1(&bad,buffer,262144,&out)!=3)return 28;
 const YNXNetworkResourceBytesV1 all[]={sign->current.subject_owner,sign->current.policy_original,sign->pk_a,sign->pk_b,sign->pkcs8_a,sign->pkcs8_b};
 for(int i=0;i<6;i++){unsigned char before[40];memcpy(before,all[i].bytes,40);if(YNXNetworkResourceConsentAttemptV1(sign,buffer,262144,(YNXNetworkResourceConsentResultV1*)all[i].bytes)!=3 || memcmp(before,all[i].bytes,40))return 30+i;}
 if(YNXNetworkResourceConsentAttemptV1(sign,buffer,262144,(YNXNetworkResourceConsentResultV1*)buffer)!=3)return 36;
 // Total reserved public-byte cap must fail before any private operation.
 uint64_t extra[32];size_t count=0;int limited=0;
 for(size_t i=0;i<32;i++){int e=YNXNetworkResourceConsentAttemptV1(prepare,NULL,0,&out);if(e==15){limited=1;break;}if(e||!out.handle)return 37;extra[count++]=out.handle;}
 if(!limited)return 38;
 for(size_t i=0;i<count;i++){YNXNetworkResourceConsentRequestV1 r=resource_action(8,extra[i]);if(YNXNetworkResourceConsentAttemptV1(&r,buffer,262144,&out))return 39;r=resource_action(9,extra[i]);if(YNXNetworkResourceConsentAttemptV1(&r,NULL,0,&out)||out.handle)return 40;}
 // Actual fixed dual signature; no alternate signing implementation in C.
 if(YNXNetworkResourceConsentAttemptV1(sign,buffer,262144,&out)!=0 || !out.member_length || out.cleanup_status!=2 || (out.flags&397)!=397 || (out.flags&16))return 41;
 size_t n=out.member_length;uint8_t *saved=(uint8_t*)malloc(n);if(!saved)return 42;memcpy(saved,buffer,n);
 resource_wipe((void*)sign->pkcs8_a.bytes,sign->pkcs8_a.length);resource_wipe((void*)sign->pkcs8_b.bytes,sign->pkcs8_b.length);
 if(YNXNetworkResourceConsentAttemptV1(sign,buffer,262144,&out)!=12 || out.member_length!=n || memcmp(saved,buffer,n)){free(saved);return 43;}
 YNXNetworkResourceConsentRequestV1 r=resource_action(4,handle);r.current=sign->current;r.current.now_millis++;
 if(YNXNetworkResourceConsentAttemptV1(&r,buffer,262144,&out)!=0 || !(out.flags&16) || (out.flags&256) || out.member_length!=n || memcmp(saved,buffer,n)){free(saved);return 44;}
 r=resource_action(2,handle);r.current=sign->current;r.current.execution_height--;
 if(YNXNetworkResourceConsentAttemptV1(&r,NULL,0,&out)!=8 || out.first_cause!=8 || !(out.flags&256) || (out.flags&16)){free(saved);return 45;}
 r=resource_action(5,handle);if(YNXNetworkResourceConsentAttemptV1(&r,buffer,262144,&out)!=0 || out.first_cause!=8 || out.member_length!=n || memcmp(saved,buffer,n)){free(saved);return 46;}
 r=resource_action(8,handle);if(YNXNetworkResourceConsentAttemptV1(&r,buffer,262144,&out)!=0 || (out.flags&224)!=224 || out.member_length!=n || memcmp(saved,buffer,n)){free(saved);return 47;}
 r=resource_action(9,handle);if(YNXNetworkResourceConsentAttemptV1(&r,NULL,0,&out)!=0 || out.handle){free(saved);return 48;}
 r=resource_action(5,handle);if(YNXNetworkResourceConsentAttemptV1(&r,buffer,262144,&out)!=11){free(saved);return 49;}
 memcpy(buffer,saved,n);*saved_length=n;free(saved);return 0;
}
*/
import "C"
import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	consent "github.com/JiahaoAlbus/YNX-Chain/internal/ynxresourceconsent"
	"unsafe"
)

type resourceForeignInput struct {
	scope, input []byte
	b            ynxbatch.NetworkResourceConsentBinding
	current      consent.CurrentDATA
	material     ynxbatch.KeyMaterial
}

func resourceForeignControls(in resourceForeignInput) (int, []byte) {
	type allocation struct {
		p unsafe.Pointer
		n int
	}
	var allocations []allocation
	span := func(b []byte) C.YNXNetworkResourceBytesV1 {
		n := len(b)
		if n < 64 {
			n = 64
		}
		p := C.calloc(1, C.size_t(n))
		if p == nil {
			panic("C allocation")
		}
		copy(unsafe.Slice((*byte)(p), n), b)
		allocations = append(allocations, allocation{p, n})
		return C.YNXNetworkResourceBytesV1{bytes: (*C.uint8_t)(p), length: C.size_t(len(b))}
	}
	defer func() {
		for _, a := range allocations {
			C.resource_wipe(a.p, C.size_t(a.n))
			C.free(a.p)
		}
	}()
	c := C.YNXNetworkResourceCurrentDATAV1{subject_owner: span([]byte(in.current.SubjectOwner)), policy_original: span(in.current.PolicyOriginal), execution_height: C.uint64_t(in.current.ExecutionHeight), now_millis: C.int64_t(in.current.NowMillis)}
	p := C.YNXNetworkResourceConsentRequestV1{abi_version: 1, action: 1, struct_size: 264, scope_original: span(in.scope), input_original: span(in.input), expected: C.YNXNetworkResourceBindingV1{network_id: span(in.b.NetworkID), owner: span([]byte(in.b.Owner)), key_epoch: span([]byte(in.b.KeyEpoch)), issued_height: span([]byte(in.b.IssuedHeight)), pk_a: span(in.b.PKA), pk_b: span(in.b.PKB)}, current: c}
	s := C.YNXNetworkResourceConsentRequestV1{abi_version: 1, action: 3, struct_size: 264, current: c, pkcs8_a: span(in.material.PKCS8A), pkcs8_b: span(in.material.PKCS8B), pk_a: span(in.material.PKA), pk_b: span(in.material.PKB)}
	out := C.malloc(resourceMemberCapacity)
	if out == nil {
		panic("C output allocation")
	}
	defer C.free(out)
	var length C.size_t
	code := int(C.resource_foreign_controls(&p, &s, (*C.uint8_t)(out), &length))
	if code != 0 {
		return code, nil
	}
	return 0, C.GoBytes(out, C.int(length))
}
