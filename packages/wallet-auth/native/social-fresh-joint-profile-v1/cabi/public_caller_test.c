//go:build social_joint_data_test

#include "social_fresh_joint_profile_data.h"
#include "public_golden_test.h"
#include <string.h>
#include <stdlib.h>
#include <stdalign.h>
#include <limits.h>
#define S(s) ((YNXSocialJointSpan){(const uint8_t*)(s),sizeof(s)-1})
static const uint8_t classic33[33]={5};
static const uint8_t pq2592[2592]={0};
static const char hexa[]="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
static const char hexb[]="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
static const char hexd[]="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
static void fixture(YNXSocialFreshJointProfileInputV1 *x,YNXSocialJointPolicy10 *i,YNXSocialJointPolicy10 *a){
 memset(x,0,sizeof(*x));memset(i,0,sizeof(*i));
 x->abi_version=1;x->struct_size=sizeof(*x);
 x->captured.history_original=S("{\"PUBLIC_SIGNED_history\":\"nonce_A\"}");x->captured.issuer_original=S("PUBLIC_registered_issuer");x->captured.anchor_original=S("PUBLIC_registered_anchor");x->captured.registration_original=S("PUBLIC_registration");
 x->captured.scope.source=S("source");x->captured.scope.store=S("store");x->captured.scope.schema=S("schema");x->captured.scope.inode=S("inode");x->captured.scope.restore=S("restore");x->captured.scope.source_generation=UINT64_C(9007199254740993);x->captured.scope.native_restore_incarnation=UINT64_MAX;x->captured.issuer_epoch=17;x->captured.anchor_epoch=UINT64_C(9007199254740995);x->captured.history_issued_ms=1000;x->captured.history_expires_ms=30000;x->captured.captured_deadline_ms=25000;
 x->binding.realm=S("realm");x->binding.client=S("social-client");x->binding.network=S("policy-network-ASCII");x->binding.identity=S("identity");x->binding.device=S("signal-device");x->binding.header_sha256=S(hexa);x->binding.classic_public=(YNXSocialJointSpan){classic33,33};x->binding.pq_public=(YNXSocialJointSpan){pq2592,2592};
 YNXSocialJointExpected17 *e=&x->binding.expected;e->network_id=S(hexb);e->canonical_owner=S("0xcccccccccccccccccccccccccccccccccccccccc");e->account=S("account");e->session_binding=S("session");e->product_id=S("social");e->client_id=S("client");e->platform=S("linux");e->application_id=S("app");e->bundle_id.is_null=1;e->package_id.is_null=1;e->origin=S("https://social.invalid");e->callback=S("callback");e->device_id=S("device");e->generation=S("9007199254740997");e->registration_id=S("registration");e->revision=S("11");e->registration_digest=S(hexd);
 i->version=1;i->purpose=S("YNX/SOCIAL/DEVICE-SESSION-PRINCIPAL/V1");i->role=S("issuer");i->realm=x->binding.realm;i->client=x->binding.client;i->network=x->binding.network;i->header_sha256=x->binding.header_sha256;i->not_before_ms=500;i->expires_ms=40000;i->max_lifetime_ms=30000;*a=*i;a->role=S("anchor");x->issuer_policy=i;x->anchor_policy=a;x->window=(YNXSocialJointWindow){2000,24000,3000};
}
static int all(const uint8_t*p,size_t n,uint8_t v){for(size_t j=0;j<n;j++){if(p[j]!=v)return 0;}return 1;}
/* Returns source line on failure. All data and caller buffers are C-owned. */
int public_social_cabi_scenario(int which){
 YNXSocialFreshJointProfileInputV1 x;YNXSocialJointPolicy10 i,a;fixture(&x,&i,&a);
 union{max_align_t align;uint8_t bytes[32768];} u;
 uint8_t hash[64];size_t written=777;memset(u.bytes,0xa5,sizeof(u.bytes));memset(hash,0xb6,sizeof(hash));
 uint8_t *out=u.bytes,*hashout=hash;size_t capacity=32768;size_t *wp=&written;
 YNXSocialJointSpan original={(const uint8_t*)public_golden,sizeof(public_golden)-1};int inspect=0;char changed[sizeof(public_golden)+1];uint8_t invalid_utf8[]={0xff};uint8_t *large=NULL;
 switch(which){
 case 0:break;
 case 1:capacity=sizeof(public_golden)-2;break;
 case 2:x.captured.history_original.data=NULL;break;
 case 3:x.captured.history_original.length=65537;break;
 case 4:x.captured.history_original.length=SIZE_MAX;break;
 case 5:hashout=out+4;break;
 case 6:x.captured.history_original.data=out;break;
 case 7:x.issuer_policy=NULL;break;
 case 8:x.binding.expected.bundle_id.is_null=2;break;
 case 9:x.captured.scope.source=(YNXSocialJointSpan){invalid_utf8,1};break;
 case 10:inspect=1;changed[0]=' ';memcpy(changed+1,public_golden,sizeof(public_golden)-1);original=(YNXSocialJointSpan){(const uint8_t*)changed,sizeof(public_golden)};break;
 case 11:inspect=1;original.length=32769;break;
 case 12:capacity=32769;break;
 case 13:x.window.expires_ms=INT64_MAX;break;
 case 14:i.role=S("record-issuer");break;
 case 15:capacity=0;break;
 case 16:wp=NULL;break;
 case 17:x.captured.history_original=(YNXSocialJointSpan){(const uint8_t*)(UINTPTR_MAX-2),8};break;
 case 18:out=(uint8_t*)(UINTPTR_MAX-8);capacity=16;break;
 case 19:large=(uint8_t*)malloc(65536);if(!large)return __LINE__;memset(large,'P',65536);x.captured.history_original=(YNXSocialJointSpan){large,65536};x.captured.issuer_original=x.captured.history_original;x.captured.anchor_original=x.captured.history_original;x.captured.registration_original=x.captured.history_original;break;
 case 20:inspect=1;break;
 case 21:x.abi_version=2;break;
 case 22:x.struct_size--;break;
 case 23:x.window.issued_ms=INT64_MIN;break;
 case 24:inspect=1;x.captured.anchor_epoch++;break;
 default:return __LINE__;
 }
 int32_t rc=inspect?YNXSocialFreshJointProfileInspectBodyDATA(original,&x,out,capacity,wp,hashout):YNXSocialFreshJointProfilePrepareBodyDATA(&x,out,capacity,wp,hashout);
 if(which==0||which==20){if(rc!=0||written!=sizeof(public_golden)-1||memcmp(u.bytes,public_golden,written)||memcmp(hash,public_history_hash,64)||!all(u.bytes+written,sizeof(u.bytes)-written,0xa5))return __LINE__;return 0;}
 if(which==19){free(large);if(rc!=0||written==0||written>32768||!all(u.bytes+written,sizeof(u.bytes)-written,0xa5))return __LINE__;return 0;}
 if(rc==0||!all(u.bytes,sizeof(u.bytes),0xa5)||!all(hash,sizeof(hash),0xb6)||written!=777)return __LINE__;
 if(which==7&&rc!=YNX_SOCIAL_JOINT_DATA_NOT_SUPPLIED)return __LINE__;
 if(which==1&&rc!=YNX_SOCIAL_JOINT_DATA_CAPACITY)return __LINE__;
 return 0;
}
