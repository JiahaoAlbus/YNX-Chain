#include "ynx_source_server_resource_owner.h"
#include "ynx_source_administration_owner.h"
#include "ynx_source_original_resource_owner.h"
#include <openssl/sha.h>
#include <openssl/crypto.h>
#include <pthread.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>
#include <tss2_mu.h>
#include "ynx_source_sealed_role_launcher.h"
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <sys/socket.h>
#include <netinet/in.h>
static uint16_t be16(const unsigned char *p){return (uint16_t)((uint16_t)p[0]<<8|p[1]);}
static uint32_t be32(const unsigned char *p){return (uint32_t)p[0]<<24|(uint32_t)p[1]<<16|(uint32_t)p[2]<<8|p[3];}
static void put16(unsigned char*p,uint16_t n){p[0]=(unsigned char)(n>>8);p[1]=(unsigned char)n;}
static void put32(unsigned char*p,uint32_t n){p[0]=(unsigned char)(n>>24);p[1]=(unsigned char)(n>>16);p[2]=(unsigned char)(n>>8);p[3]=(unsigned char)n;}
veil_store_status ynx_server_attestation_decode(ynx_original_bytes raw,uint32_t kind,ynx_private_attestation_parts *out){
 if(!out)return VEIL_STORE_BOUND;memset(out,0,sizeof(*out));
 if((kind!=1&&kind!=2)||!raw.data||raw.size<24||raw.size>YNX_PRIVATE_ATTEST_MAX)return VEIL_STORE_BOUND;
 const unsigned char*p=raw.data;if(memcmp(p,"YNXATP1\0",8)||be16(p+8)!=1||be16(p+10)!=kind)return VEIL_STORE_MISMATCH;
 size_t an=be32(p+12),sn=be32(p+16);if(an<2||an>8192||sn<2||sn>8192||an+sn!=raw.size-20)return VEIL_STORE_BOUND;
 TPM2B_ATTEST a;TPMT_SIGNATURE s;unsigned char roundtrip[8192];size_t at=0,n=0;
 if(Tss2_MU_TPM2B_ATTEST_Unmarshal(p+20,an,&at,&a)||at!=an||Tss2_MU_TPM2B_ATTEST_Marshal(&a,roundtrip,sizeof(roundtrip),&n)||n!=an||memcmp(roundtrip,p+20,an))return VEIL_STORE_MISMATCH;
 at=0;n=0;if(Tss2_MU_TPMT_SIGNATURE_Unmarshal(p+20+an,sn,&at,&s)||at!=sn||Tss2_MU_TPMT_SIGNATURE_Marshal(&s,roundtrip,sizeof(roundtrip),&n)||n!=sn||memcmp(roundtrip,p+20+an,sn))return VEIL_STORE_MISMATCH;
 TPMS_ATTEST decoded;at=0;if(Tss2_MU_TPMS_ATTEST_Unmarshal(a.attestationData,a.size,&at,&decoded)||at!=a.size||decoded.magic!=TPM2_GENERATED_VALUE||decoded.type!=(kind==1?TPM2_ST_ATTEST_QUOTE:TPM2_ST_ATTEST_NV))return VEIL_STORE_MISMATCH;
 out->attestation=(ynx_message_bytes){p+20,an};out->signature=(ynx_message_bytes){p+20+an,sn};return VEIL_STORE_OK;
}
veil_store_status ynx_server_execution_challenge(ynx_original_bytes raw,uint32_t role,unsigned char out[32]){
 if(!out)return VEIL_STORE_BOUND;memset(out,0,32);
 if((role!=1&&role!=2)||!raw.data||raw.size<80||raw.size>4194304u+80u||memcmp(raw.data,"YNXEXE1\0",8)||be16(raw.data+8)!=1||be16(raw.data+10)<1||be16(raw.data+10)>7||be32(raw.data+12)!=raw.size-80)return VEIL_STORE_BOUND;
 unsigned char id=0;for(size_t n=16;n<48;n++)id|=raw.data[n];if(!id)return VEIL_STORE_BOUND;
 int32_t canonical=ynx_sdk_execution_original_validate_v1(raw.data,raw.size);if(canonical)return (veil_store_status)canonical;
 static const unsigned char label[]="YNX/SOCIAL/PRIVATE-EXECUTION-ATTEST/V1";
 unsigned char preimage[sizeof(label)+4+32];memcpy(preimage,label,sizeof(label));put32(preimage+sizeof(label),role);
 if(!SHA256(raw.data,raw.size,preimage+sizeof(label)+4)||!SHA256(preimage,sizeof(preimage),out)){OPENSSL_cleanse(out,32);OPENSSL_cleanse(preimage,sizeof(preimage));return VEIL_STORE_UNKNOWN;}
 OPENSSL_cleanse(preimage,sizeof(preimage));return VEIL_STORE_OK;
}
veil_store_status ynx_server_attestation_encode(uint32_t kind,const TPM2B_ATTEST *a,const TPMT_SIGNATURE *s,unsigned char *sink,size_t cap,size_t *written){
 if(written)*written=0;if(!written||!sink||!a||!s||(kind!=1&&kind!=2)||cap>YNX_PRIVATE_ATTEST_MAX||cap<24)return VEIL_STORE_BOUND;
 size_t an=0,sn=0;TSS2_RC rc=Tss2_MU_TPM2B_ATTEST_Marshal(a,sink+20,cap-20,&an);
 if(!rc&&an<=8192)rc=Tss2_MU_TPMT_SIGNATURE_Marshal(s,sink+20+an,cap-20-an,&sn);
 if(rc||an<2||an>8192||sn<2||sn>8192){OPENSSL_cleanse(sink,cap);return VEIL_STORE_BOUND;}
 memcpy(sink,"YNXATP1\0",8);put16(sink+8,1);put16(sink+10,(uint16_t)kind);put32(sink+12,(uint32_t)an);put32(sink+16,(uint32_t)sn);
 ynx_private_attestation_parts parts={0};veil_store_status st=ynx_server_attestation_decode((ynx_original_bytes){sink,20+an+sn},kind,&parts);if(st){OPENSSL_cleanse(sink,cap);return st;}
 *written=20+an+sn;return VEIL_STORE_OK;
}
/* An independent-state borrow is never created from a numeric projection. Its
 * producing constructor must own the same actual protected floor/current/fence.
 * The inventory below is populated ONLY by that selected Native constructor. */
struct ynx_server_independent_state_borrow {
 pthread_t thread;uint32_t role;unsigned char request_digest[32];uint64_t counter;
 uint64_t deadline_ns;veil_store_status first;int unknown;
 ynx_tpm2_owner *attestation_owner;const ynx_message_enrollment_public_input *enrollment;int proof_started;
 TPM2B_ATTEST *quote_attest,*nv_attest;TPMT_SIGNATURE *quote_signature,*nv_signature;
 unsigned char *proof_bytes;size_t quote_size,nv_size;
 ynx_platform_original_hold *original;struct ynx_server_independent_state_borrow *next;
};
static pthread_mutex_t state_lock=PTHREAD_MUTEX_INITIALIZER;
static ynx_server_independent_state_borrow *state_inventory;
static ynx_server_independent_state_borrow *state_recognize(const ynx_server_independent_state_borrow *p){
 pthread_mutex_lock(&state_lock);ynx_server_independent_state_borrow *held=state_inventory;while(held&&held!=p)held=held->next;pthread_mutex_unlock(&state_lock);return held;
}
static veil_store_status state_uncertain(ynx_server_independent_state_borrow *held,veil_store_status cause){
 if(!held->first)held->first=cause;held->unknown=1;return VEIL_STORE_UNKNOWN;
}
static veil_store_status state_current(const ynx_server_independent_state_borrow *p,ynx_original_bytes request,uint32_t role,uint64_t *counter){
 if(!p||!counter)return VEIL_STORE_REQUIRED;
 *counter=0;ynx_server_independent_state_borrow *held=state_recognize(p);
 if(!held)return VEIL_STORE_REQUIRED;if(!pthread_equal(held->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(held->unknown)return VEIL_STORE_UNKNOWN;
 struct timespec now;if(!held->deadline_ns||clock_gettime(CLOCK_MONOTONIC,&now))return VEIL_STORE_LIFETIME;
 uint64_t ns=(uint64_t)now.tv_sec*1000000000u+(uint64_t)now.tv_nsec;if(ns>=held->deadline_ns)return VEIL_STORE_LIFETIME;
 int32_t canonical=ynx_sdk_execution_original_validate_v1(request.data,request.size);if(canonical)return (veil_store_status)canonical;
 unsigned char digest[32];if(!request.data||!SHA256(request.data,request.size,digest)||held->role!=role||CRYPTO_memcmp(digest,held->request_digest,32))return VEIL_STORE_MISMATCH;
 /* This is an existing independent borrow, not an acquisition probe. Once
  * its original current fence refuses, later restoration of the underlying
  * observation must not make this same borrow green again. */
 veil_store_status st=ynx_platform_current(held->original,0);if(st)return state_uncertain(held,st);
 /* The same original resource may outlive its budget while current executes.
  * Do not publish a counter after the retained deadline; no window renewal. */
 if(clock_gettime(CLOCK_MONOTONIC,&now))return state_uncertain(held,VEIL_STORE_LIFETIME);
 ns=(uint64_t)now.tv_sec*1000000000u+(uint64_t)now.tv_nsec;
 if(ns>=held->deadline_ns)return state_uncertain(held,VEIL_STORE_LIFETIME);
 *counter=held->counter;return VEIL_STORE_OK;
}
veil_store_status ynx_server_independent_state_release(ynx_server_independent_state_borrow **p){
 if(!p)return VEIL_STORE_BOUND;if(!*p)return VEIL_STORE_OK;
 ynx_server_independent_state_borrow *held=state_recognize(*p);if(!held)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(held->thread,pthread_self()))return VEIL_STORE_THREAD;
 /* Release only this exclusive borrow. The original execution attempt still
  * retains its actual floor/reservation owner and durable UNKNOWN; this is
  * neither retirement nor an implicit platform drop/retry. */
 veil_store_status st=ynx_platform_current(held->original,1);if(st){state_uncertain(held,st);return st;}
 pthread_mutex_lock(&state_lock);ynx_server_independent_state_borrow **link=&state_inventory;while(*link&&*link!=held)link=&(*link)->next;
 if(*link!=held){pthread_mutex_unlock(&state_lock);return VEIL_STORE_REQUIRED;}*link=held->next;pthread_mutex_unlock(&state_lock);
 Esys_Free(held->quote_attest);Esys_Free(held->quote_signature);Esys_Free(held->nv_attest);Esys_Free(held->nv_signature);
 if(held->proof_bytes){OPENSSL_cleanse(held->proof_bytes,2u*YNX_PRIVATE_ATTEST_MAX);free(held->proof_bytes);}
 OPENSSL_cleanse(held,sizeof(*held));free(held);*p=NULL;return VEIL_STORE_OK;
}
veil_store_status ynx_server_original_attestations_verify(const ynx_message_enrollment_public_input *enrollment,ynx_original_bytes request,uint32_t role,ynx_original_bytes quote,ynx_original_bytes certify,const ynx_server_independent_state_borrow *counter_owner){
 uint64_t expected=0;veil_store_status st=state_current(counter_owner,request,role,&expected);if(st)return st;
 ynx_private_attestation_parts q={0},n={0};TPM2B_DATA challenge={.size=32};
 st=ynx_server_execution_challenge(request,role,challenge.buffer);if(!st)st=ynx_server_attestation_decode(quote,1,&q);if(!st)st=ynx_server_attestation_decode(certify,2,&n);
 if(!st){ynx_message_attestation_input original={enrollment,q.attestation,q.signature,n.attestation,n.signature,&challenge,expected};int observed=ynx_message_enrollment_verify_attestations(&original);if(observed)st=observed==YNX_TPM2_REQUIRED?VEIL_STORE_REQUIRED:VEIL_STORE_MISMATCH;}
 uint64_t late=0;veil_store_status after=state_current(counter_owner,request,role,&late);if(after||late!=expected){ynx_server_independent_state_borrow *held=state_recognize(counter_owner);if(held&&pthread_equal(held->thread,pthread_self()))return state_uncertain(held,after?after:VEIL_STORE_MISMATCH);return VEIL_STORE_UNKNOWN;}
 return st; /* math only; no floor/resource/terminal owner is published */
}
veil_store_status ynx_server_execution_original_attestations(ynx_server_independent_state_borrow *p,const ynx_message_enrollment_public_input *enrollment,ynx_original_bytes request,uint32_t role,ynx_original_bytes *quote,ynx_original_bytes *certify){
 if(!quote||!certify||quote==certify)return VEIL_STORE_BOUND;*quote=(ynx_original_bytes){0};*certify=(ynx_original_bytes){0};
 uint64_t expected=0;veil_store_status st=state_current(p,request,role,&expected);if(st)return st;
 ynx_server_independent_state_borrow *held=state_recognize(p);if(!held||!held->attestation_owner||!held->enrollment)return VEIL_STORE_REQUIRED;
 if(enrollment!=held->enrollment)return VEIL_STORE_MISMATCH;
 /* A repeated read revalidates original proof bytes; it never repeats Quote
  * or Certify. Partial command state is kept by this same borrow for cleanup. */
 if(!held->proof_started){
  TPM2B_DATA challenge={.size=32};st=ynx_server_execution_challenge(request,role,challenge.buffer);if(st)return st;
  held->proof_bytes=calloc(2u,YNX_PRIVATE_ATTEST_MAX);if(!held->proof_bytes)return VEIL_STORE_BOUND;
  held->proof_started=1;
  int observed=ynx_tpm2_owner_quote(held->attestation_owner,&challenge,&held->quote_attest,&held->quote_signature);
  if(observed)return state_uncertain(held,observed==YNX_TPM2_REQUIRED?VEIL_STORE_REQUIRED:VEIL_STORE_UNKNOWN);
  if(!held->quote_attest||!held->quote_signature)return state_uncertain(held,VEIL_STORE_MISMATCH);
  st=ynx_server_attestation_encode(1,held->quote_attest,held->quote_signature,held->proof_bytes,YNX_PRIVATE_ATTEST_MAX,&held->quote_size);if(st)return state_uncertain(held,st);
  uint64_t between=0;st=state_current(p,request,role,&between);if(st||between!=expected)return state_uncertain(held,st?st:VEIL_STORE_MISMATCH);
  observed=ynx_tpm2_owner_certify(held->attestation_owner,&challenge,&held->nv_attest,&held->nv_signature);
  if(observed)return state_uncertain(held,observed==YNX_TPM2_REQUIRED?VEIL_STORE_REQUIRED:VEIL_STORE_UNKNOWN);
  if(!held->nv_attest||!held->nv_signature)return state_uncertain(held,VEIL_STORE_MISMATCH);
  st=ynx_server_attestation_encode(2,held->nv_attest,held->nv_signature,held->proof_bytes+YNX_PRIVATE_ATTEST_MAX,YNX_PRIVATE_ATTEST_MAX,&held->nv_size);if(st)return state_uncertain(held,st);
 }
 if(!held->quote_size||!held->nv_size)return state_uncertain(held,VEIL_STORE_MISMATCH);
 ynx_original_bytes q={held->proof_bytes,held->quote_size},n={held->proof_bytes+YNX_PRIVATE_ATTEST_MAX,held->nv_size};
 st=ynx_server_original_attestations_verify(enrollment,request,role,q,n,p);if(st)return state_uncertain(held,st);
 uint64_t late=0;st=state_current(p,request,role,&late);if(st||late!=expected)return state_uncertain(held,st?st:VEIL_STORE_MISMATCH);
 *quote=q;*certify=n;return VEIL_STORE_OK; /* unsigned verified observation only */
}

/* The backend adopts private startup custody before any post-acquire check.
 * This inventory is separate from SDK/public manifest handles. A partial
 * backend is never a recognized connection or independent counter owner. */
struct ynx_server_retained_operation {
 unsigned char reference[32],constraints[436];uint64_t deadline;
 ynx_original_executor *executor;veil_store_status first;int unknown,closed;
 struct ynx_server_retained_operation *next;
};
struct ynx_selected_server_backend{
 pthread_t thread;uint32_t role;void *startup;veil_store_status first;int unknown;
 ynx_source_sealed_role_owner *server_key;SSL_CTX *server_context;int transport_started;
 ynx_administration_owner *administration;
 /* Detached uncertain attempts retain their exact request/first cause until
  * explicit enclosing disposal. They are no longer callable or borrowers. */
 struct ynx_server_execution_attempt *cleanup_attempts;
 struct ynx_server_retained_operation *operations;
 uint64_t transport_deadline_ns;int64_t transport_not_before_ms,transport_expires_ms;
 size_t listeners,connections,attempts,seen_count;unsigned char seen_ids[128][32];unsigned char *registered_bytes;size_t association_size,registration_size,certificate_size,row_size;unsigned char resource_names[3][34];uint32_t resource_kinds[3];struct ynx_selected_server_backend *next;
};
static pthread_mutex_t backend_lock=PTHREAD_MUTEX_INITIALIZER;
static ynx_selected_server_backend *backend_inventory;
static ynx_selected_server_backend *backend_recognize(ynx_selected_server_backend *p){
 pthread_mutex_lock(&backend_lock);ynx_selected_server_backend *held=backend_inventory;while(held&&held!=p)held=held->next;pthread_mutex_unlock(&backend_lock);return held;
}
struct ynx_registered_native_connection {
 pthread_t thread;ynx_selected_server_backend *backend;struct ssl_st *tls;
 ynx_native_server_listener *listener;int fd,owns_fd;
 unsigned char *incoming;size_t incoming_size,incoming_cap,header_size,body_size;int request_ready;
 size_t attempts;uint64_t deadline_ns;veil_store_status first;int unknown,handshake;
 struct ynx_registered_native_connection *next;
};
struct ynx_native_server_listener{
 pthread_t thread;ynx_selected_server_backend *backend;int fd;size_t children;
 veil_store_status first;int unknown;struct ynx_native_server_listener *next;
};
static ynx_native_server_listener *listener_inventory;
/* Only the fixed selected transport constructor may populate this inventory;
 * SSL pointers received from a receiver are not registration capabilities. */
static ynx_registered_native_connection *connection_inventory;
struct ynx_server_execution_attempt {
 pthread_t thread;ynx_selected_server_backend *backend;
 ynx_registered_native_connection *connection;
 unsigned char *request;size_t request_size;uint64_t deadline_ns;
 veil_store_status first;int unknown;size_t borrows;
 struct ynx_server_retained_operation *operation;
 unsigned char response[84];int executed,response_ready;
 struct ynx_server_execution_attempt *next;
};
static ynx_server_execution_attempt *execution_inventory;
static ynx_server_execution_attempt *execution_recognize(ynx_server_execution_attempt *p){
 pthread_mutex_lock(&backend_lock);ynx_server_execution_attempt *h=execution_inventory;
 while(h&&h!=p)h=h->next;pthread_mutex_unlock(&backend_lock);return h;
}
static veil_store_status execution_uncertain(ynx_server_execution_attempt *h,veil_store_status cause){
 if(!h->first)h->first=cause;h->unknown=1;
 /* This attempt borrowed the same backend; another child must not observe a
  * green backend after this original current/fence has become uncertain. */
 if(!h->backend->first)h->backend->first=cause;h->backend->unknown=1;
 return VEIL_STORE_UNKNOWN;
}
static int execution_time(uint64_t *mono,uint64_t *wall){
 struct timespec m,w;if(clock_gettime(CLOCK_MONOTONIC,&m)||clock_gettime(CLOCK_REALTIME,&w)||m.tv_sec<0||w.tv_sec<0)return 0;
 *mono=(uint64_t)m.tv_sec*1000000000u+(uint64_t)m.tv_nsec;
 *wall=(uint64_t)w.tv_sec*1000u+(uint64_t)w.tv_nsec/1000000u;return 1;
}
static uint64_t execution_be64(const unsigned char*p){uint64_t n=0;for(size_t i=0;i<8;i++)n=(n<<8)|p[i];return n;}
static veil_store_status transport_status(int st){return st==YNX_TPM2_OK?VEIL_STORE_OK:st==YNX_TPM2_REQUIRED?VEIL_STORE_REQUIRED:st==YNX_TPM2_UNKNOWN?VEIL_STORE_UNKNOWN:VEIL_STORE_MISMATCH;}
static veil_store_status backend_transport_uncertain(ynx_selected_server_backend *b,veil_store_status cause){if(!b->first)b->first=cause;b->unknown=1;return VEIL_STORE_UNKNOWN;}
static veil_store_status backend_transport_current(ynx_selected_server_backend *b){
 if(b->unknown)return VEIL_STORE_UNKNOWN;
 uint64_t mono=0,wall=0;
 if(!execution_time(&mono,&wall)||b->transport_not_before_ms<0||b->transport_expires_ms<=b->transport_not_before_ms||wall<(uint64_t)b->transport_not_before_ms||wall>=(uint64_t)b->transport_expires_ms||!b->transport_deadline_ns||mono>=b->transport_deadline_ns)return backend_transport_uncertain(b,VEIL_STORE_LIFETIME);
 veil_store_status s=(veil_store_status)ynx_sdk_server_startup_current_v1(b->startup,b->role);
 if(!s)s=b->server_key?transport_status(ynx_source_sealed_role_current(b->server_key)):VEIL_STORE_REQUIRED;
 return s?backend_transport_uncertain(b,s):VEIL_STORE_OK;
}
veil_store_status ynx_server_transport_open(ynx_selected_server_backend *p,const ynx_message_sealed_raw_input *selected,ynx_original_bytes certificate,const unsigned char expected[32]){
 ynx_selected_server_backend *b=backend_recognize(p);if(!b)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(b->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(!selected||!certificate.data||!certificate.size||certificate.size>65536||!expected)return VEIL_STORE_BOUND;
 if(b->unknown)return VEIL_STORE_UNKNOWN;if(b->transport_started)return VEIL_STORE_DUPLICATE;
 uint64_t mono=0,wall=0;
 if(selected->not_before_ms<0||selected->expires_ms<=selected->not_before_ms||!selected->monotonic_deadline_ns||!execution_time(&mono,&wall)||wall<(uint64_t)selected->not_before_ms||wall>=(uint64_t)selected->expires_ms||mono>=selected->monotonic_deadline_ns)return VEIL_STORE_LIFETIME;
 veil_store_status s=ynx_server_selected_backend_original_current(b);if(s)return s;
 /* The PRIVATE Name selects a resource, not a grant. Require the DISTINCT
  * original selected TLS object; never consume issuer/anchor wrapping keys or
  * a storage/state object merely because its Unseal would succeed. */
 if(b->resource_kinds[0]!=1)return VEIL_STORE_REQUIRED;
 if(!selected->fields[8].raw||selected->fields[8].size!=34||CRYPTO_memcmp(selected->fields[8].raw,b->resource_names[0],34))return VEIL_STORE_MISMATCH;
 for(size_t n=1;n<3;n++)if(b->resource_kinds[n]==1&&!CRYPTO_memcmp(b->resource_names[0],b->resource_names[n],34))return VEIL_STORE_MISMATCH;
 unsigned char digest[32];if(!SHA256(certificate.data,certificate.size,digest)||CRYPTO_memcmp(digest,expected,32))return VEIL_STORE_MISMATCH;
 /* Adopt irreversibility before the only resource acquisition. The backend
  * was already published by transfer; all partial secret/context custody is
  * reachable for explicit close even when any late observation refuses. */
 b->transport_started=1;
 b->transport_deadline_ns=selected->monotonic_deadline_ns;b->transport_not_before_ms=selected->not_before_ms;b->transport_expires_ms=selected->expires_ms;
 s=transport_status(ynx_source_message_sealed_open_raw(selected,&b->server_key));
 if(s)return backend_transport_uncertain(b,s);
 if(!b->server_key)return backend_transport_uncertain(b,VEIL_STORE_MISMATCH);
 b->server_context=SSL_CTX_new(TLS_server_method());
 if(!b->server_context||SSL_CTX_set_min_proto_version(b->server_context,TLS1_3_VERSION)!=1||SSL_CTX_set_max_proto_version(b->server_context,TLS1_3_VERSION)!=1)return backend_transport_uncertain(b,VEIL_STORE_REQUIRED);
 const unsigned char *at=certificate.data;X509 *server=d2i_X509(NULL,&at,(long)certificate.size);
 int ok=server&&at==certificate.data+certificate.size&&SSL_CTX_use_certificate(b->server_context,server)==1;X509_free(server);
 if(!ok)return backend_transport_uncertain(b,VEIL_STORE_MISMATCH);
 const unsigned char *client_raw=b->registered_bytes+b->association_size+b->registration_size;at=client_raw;
 X509 *client=d2i_X509(NULL,&at,(long)b->certificate_size);
 ok=client&&at==client_raw+b->certificate_size&&X509_STORE_add_cert(SSL_CTX_get_cert_store(b->server_context),client)==1;X509_free(client);
 if(!ok)return backend_transport_uncertain(b,VEIL_STORE_MISMATCH);
 SSL_CTX_set_verify(b->server_context,SSL_VERIFY_PEER|SSL_VERIFY_FAIL_IF_NO_PEER_CERT,NULL);
 SSL_CTX_set_options(b->server_context,SSL_OP_NO_TICKET);
 SSL_CTX_set_session_cache_mode(b->server_context,SSL_SESS_CACHE_OFF);
 s=transport_status(ynx_source_sealed_client_context_key(b->server_key,b->server_context));
 if(s)return backend_transport_uncertain(b,s);
 return backend_transport_current(b); /* key possession only, NOT admission */
}
static ynx_registered_native_connection *connection_recognize(ynx_registered_native_connection *p){
 pthread_mutex_lock(&backend_lock);ynx_registered_native_connection *c=connection_inventory;while(c&&c!=p)c=c->next;pthread_mutex_unlock(&backend_lock);return c;
}
static veil_store_status connection_uncertain(ynx_registered_native_connection *c,veil_store_status cause){if(!c->first)c->first=cause;c->unknown=1;return backend_transport_uncertain(c->backend,cause);}
veil_store_status ynx_server_connection_current(ynx_registered_native_connection *p){
 ynx_registered_native_connection *c=connection_recognize(p);if(!c)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(c->thread,pthread_self()))return VEIL_STORE_THREAD;if(c->unknown)return VEIL_STORE_UNKNOWN;
 uint64_t mono=0,wall=0;if(!execution_time(&mono,&wall)||!c->deadline_ns||mono>=c->deadline_ns)return connection_uncertain(c,VEIL_STORE_LIFETIME);
 veil_store_status s=backend_transport_current(c->backend);return s?connection_uncertain(c,s):VEIL_STORE_OK;
}
veil_store_status ynx_server_connection_open(ynx_selected_server_backend *p,int fd,uint64_t deadline,ynx_registered_native_connection **out){
 if(!out||*out||fd<0||!deadline)return VEIL_STORE_BOUND;
 ynx_selected_server_backend *b=backend_recognize(p);if(!b)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(b->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(!b->server_context||!b->server_key)return VEIL_STORE_REQUIRED;
 uint64_t mono=0,wall=0;if(!execution_time(&mono,&wall)||mono>=deadline)return VEIL_STORE_LIFETIME;
 int flags=fcntl(fd,F_GETFL);if(flags<0||!(flags&O_NONBLOCK))return VEIL_STORE_BOUND;
 veil_store_status s=backend_transport_current(b);if(s)return s;
 if(deadline>b->transport_deadline_ns)deadline=b->transport_deadline_ns;
 ynx_registered_native_connection *c=calloc(1,sizeof(*c));if(!c)return VEIL_STORE_SQL;
 c->thread=pthread_self();c->backend=b;c->deadline_ns=deadline;c->fd=fd;
 pthread_mutex_lock(&backend_lock);c->next=connection_inventory;connection_inventory=c;b->connections++;*out=c;pthread_mutex_unlock(&backend_lock);
 c->tls=SSL_new(b->server_context);
 if(!c->tls||SSL_set_fd(c->tls,fd)!=1)return connection_uncertain(c,VEIL_STORE_UNKNOWN);
 SSL_set_accept_state(c->tls);return ynx_server_connection_current(c);
}
veil_store_status ynx_server_connection_accept_step(ynx_registered_native_connection *p,int *want){
 if(!want)return VEIL_STORE_BOUND;*want=0;
 veil_store_status s=ynx_server_connection_current(p);if(s)return s;
 ynx_registered_native_connection *c=connection_recognize(p);
 if(c->handshake)return VEIL_STORE_DUPLICATE;
 int rc=SSL_accept(c->tls);
 if(rc!=1){int err=SSL_get_error(c->tls,rc);if(err!=SSL_ERROR_WANT_READ&&err!=SSL_ERROR_WANT_WRITE)return connection_uncertain(c,VEIL_STORE_UNKNOWN);
  s=ynx_server_connection_current(c);if(s)return s;*want=err==SSL_ERROR_WANT_READ?1:2;return VEIL_STORE_OK;}
 X509 *peer=SSL_get1_peer_certificate(c->tls);unsigned char *der=NULL;int n=peer?i2d_X509(peer,&der):0;
 const unsigned char *original=c->backend->registered_bytes+c->backend->association_size+c->backend->registration_size;
 int ok=peer&&SSL_version(c->tls)==TLS1_3_VERSION&&SSL_get_verify_result(c->tls)==X509_V_OK&&n>0&&(size_t)n==c->backend->certificate_size&&!CRYPTO_memcmp(der,original,(size_t)n);
 OPENSSL_free(der);X509_free(peer);if(!ok)return connection_uncertain(c,VEIL_STORE_MISMATCH);
 /* Completion can be observed only after the same original current fence.
  * The backend's registry admission/independent-state first cause remains. */
 s=ynx_server_connection_current(c);if(s)return s;c->handshake=1;return VEIL_STORE_OK;
}
veil_store_status ynx_server_connection_close(ynx_registered_native_connection **p){
 if(!p)return VEIL_STORE_BOUND;if(!*p)return VEIL_STORE_OK;
 ynx_registered_native_connection *c=connection_recognize(*p);if(!c)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(c->thread,pthread_self()))return VEIL_STORE_THREAD;if(c->attempts)return VEIL_STORE_FROZEN;
 /* Dispose SSL before dropping backend custody; no shutdown/network, replay,
  * retirement or cleanup-current that could revive this failed connection. */
 SSL_free(c->tls);c->tls=NULL;
 if(c->owns_fd&&c->fd>=0){int fd=c->fd;c->fd=-1;/* never retry close of an ambiguous descriptor number */
  if(close(fd))return connection_uncertain(c,VEIL_STORE_UNKNOWN);}
 if(c->incoming){OPENSSL_cleanse(c->incoming,c->incoming_cap);free(c->incoming);c->incoming=NULL;c->incoming_size=c->incoming_cap=0;}
 pthread_mutex_lock(&backend_lock);ynx_registered_native_connection **link=&connection_inventory;while(*link&&*link!=c)link=&(*link)->next;
 if(*link!=c||!c->backend->connections||(c->listener&&!c->listener->children)){pthread_mutex_unlock(&backend_lock);abort();}*link=c->next;c->backend->connections--;if(c->listener)c->listener->children--;pthread_mutex_unlock(&backend_lock);
 OPENSSL_cleanse(c,sizeof(*c));free(c);*p=NULL;return VEIL_STORE_OK;
}
veil_store_status ynx_server_connection_read_request(ynx_registered_native_connection *p,ynx_original_bytes *out,int *want){
 if(!out||!want)return VEIL_STORE_BOUND;*out=(ynx_original_bytes){0};*want=0;
 veil_store_status s=ynx_server_connection_current(p);if(s)return s;
 ynx_registered_native_connection *c=connection_recognize(p);if(!c->handshake)return VEIL_STORE_REQUIRED;
 if(c->request_ready){*out=(ynx_original_bytes){c->incoming+c->header_size,c->body_size};return VEIL_STORE_OK;}
 if(c->attempts)return VEIL_STORE_FROZEN;
 size_t limit=c->header_size?c->header_size+c->body_size:16384u;
 if(c->incoming_size>=limit)return connection_uncertain(c,VEIL_STORE_BOUND);
 if(c->incoming_cap<limit){unsigned char *next=realloc(c->incoming,limit);if(!next)return connection_uncertain(c,VEIL_STORE_SQL);c->incoming=next;c->incoming_cap=limit;}
 size_t received=0;int rc=SSL_read_ex(c->tls,c->incoming+c->incoming_size,limit-c->incoming_size,&received);
 if(rc!=1){int error=SSL_get_error(c->tls,rc);if(error!=SSL_ERROR_WANT_READ&&error!=SSL_ERROR_WANT_WRITE)return connection_uncertain(c,VEIL_STORE_UNKNOWN);
  s=ynx_server_connection_current(c);if(s)return s;*want=error==SSL_ERROR_WANT_READ?1:2;return VEIL_STORE_OK;}
 if(!received||received>limit-c->incoming_size)return connection_uncertain(c,VEIL_STORE_MISMATCH);
 c->incoming_size+=received; /* retain received original BEFORE late fence */
 s=ynx_server_connection_current(c);if(s)return s;
 if(!c->header_size){
  size_t end=0;for(size_t i=3;i<c->incoming_size;i++)if(!memcmp(c->incoming+i-3,"\r\n\r\n",4)){end=i+1;break;}
  if(!end){if(c->incoming_size==16384u)return connection_uncertain(c,VEIL_STORE_BOUND);*want=1;return VEIL_STORE_OK;}
  size_t body=0;s=(veil_store_status)ynx_sdk_server_request_header_validate_v1(c->backend->startup,c->backend->role,(ynx_original_bytes){c->incoming,end},&body);
  if(s)return connection_uncertain(c,s);if(body<516||body>4194384u)return connection_uncertain(c,VEIL_STORE_BOUND);
  c->header_size=end;c->body_size=body;
 }
 if(c->incoming_size>c->header_size+c->body_size)return connection_uncertain(c,VEIL_STORE_MISMATCH); /* no pipelining */
 if(c->incoming_size<c->header_size+c->body_size){*want=1;return VEIL_STORE_OK;}
 s=(veil_store_status)ynx_sdk_execution_original_validate_v1(c->incoming+c->header_size,c->body_size);if(s)return connection_uncertain(c,s);
 s=ynx_server_connection_current(c);if(s)return s;
 c->request_ready=1;*out=(ynx_original_bytes){c->incoming+c->header_size,c->body_size};return VEIL_STORE_OK;
}
static ynx_native_server_listener *listener_recognize(ynx_native_server_listener *p){
 pthread_mutex_lock(&backend_lock);ynx_native_server_listener *l=listener_inventory;while(l&&l!=p)l=l->next;pthread_mutex_unlock(&backend_lock);return l;
}
static veil_store_status listener_uncertain(ynx_native_server_listener *l,veil_store_status cause){if(!l->first)l->first=cause;l->unknown=1;return backend_transport_uncertain(l->backend,cause);}
veil_store_status ynx_server_listener_current(ynx_native_server_listener *p){
 ynx_native_server_listener *l=listener_recognize(p);if(!l)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(l->thread,pthread_self()))return VEIL_STORE_THREAD;if(l->unknown)return VEIL_STORE_UNKNOWN;
 veil_store_status s=backend_transport_current(l->backend);return s?listener_uncertain(l,s):VEIL_STORE_OK;
}
veil_store_status ynx_server_listener_open(ynx_selected_server_backend *p,ynx_native_server_listener **out){
 if(!out||*out)return VEIL_STORE_BOUND;
 ynx_selected_server_backend *b=backend_recognize(p);if(!b)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(b->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(!b->server_context||!b->server_key)return VEIL_STORE_REQUIRED;
 veil_store_status s=backend_transport_current(b);if(s)return s;
 uint16_t port=0;s=(veil_store_status)ynx_sdk_server_endpoint_port_v1(b->startup,b->role,&port);if(s)return s;if(!port)return VEIL_STORE_MISMATCH;
 ynx_native_server_listener *l=calloc(1,sizeof(*l));if(!l)return VEIL_STORE_SQL;
 l->thread=pthread_self();l->backend=b;l->fd=-1;
 pthread_mutex_lock(&backend_lock);l->next=listener_inventory;listener_inventory=l;b->listeners++;*out=l;pthread_mutex_unlock(&backend_lock);
 /* Location only. Native owns the descriptor from creation, with no adoption
  * of an Auth/JS-provided fd or SSL pointer and no process/UID authority. */
 l->fd=socket(AF_INET,SOCK_STREAM,0);if(l->fd<0)return listener_uncertain(l,VEIL_STORE_UNKNOWN);
 int flags=fcntl(l->fd,F_GETFL);if(flags<0||fcntl(l->fd,F_SETFL,flags|O_NONBLOCK)<0)return listener_uncertain(l,VEIL_STORE_UNKNOWN);
 struct sockaddr_in address={0};address.sin_family=AF_INET;address.sin_port=htons(port);address.sin_addr.s_addr=htonl(INADDR_ANY);
 if(bind(l->fd,(const struct sockaddr*)&address,sizeof(address))||listen(l->fd,128))return listener_uncertain(l,VEIL_STORE_UNKNOWN);
 return ynx_server_listener_current(l);
}
veil_store_status ynx_server_listener_accept(ynx_native_server_listener *p,uint64_t deadline,ynx_registered_native_connection **out,int *would_block){
 if(!out||*out||!would_block)return VEIL_STORE_BOUND;*would_block=0;
 veil_store_status s=ynx_server_listener_current(p);if(s)return s;
 ynx_native_server_listener *l=listener_recognize(p);uint64_t mono=0,wall=0;
 if(!deadline||!execution_time(&mono,&wall)||mono>=deadline)return VEIL_STORE_LIFETIME;
 int fd=accept(l->fd,NULL,NULL);
 if(fd<0){if(errno!=EAGAIN&&errno!=EWOULDBLOCK&&errno!=EINTR)return listener_uncertain(l,VEIL_STORE_UNKNOWN);
  s=ynx_server_listener_current(l);if(s)return s;if(!execution_time(&mono,&wall)||mono>=deadline)return VEIL_STORE_LIFETIME;*would_block=1;return VEIL_STORE_OK;}
 int flags=fcntl(fd,F_GETFL);if(flags<0||fcntl(fd,F_SETFL,flags|O_NONBLOCK)<0){(void)close(fd);return listener_uncertain(l,VEIL_STORE_UNKNOWN);}
 s=ynx_server_connection_open(l->backend,fd,deadline,out);
 if(*out){
  /* Adopt the accepted fd even on late failure. This same connection/parent
   * owns its cleanup; a failure never causes a second accept/handshake retry. */
  ynx_registered_native_connection *c=*out;c->owns_fd=1;c->listener=l;
  pthread_mutex_lock(&backend_lock);l->children++;pthread_mutex_unlock(&backend_lock);
 }else if(close(fd))return listener_uncertain(l,VEIL_STORE_UNKNOWN);
 if(s){if(*out)return listener_uncertain(l,(*out)->first?(*out)->first:s);return s;}
 s=ynx_server_listener_current(l);if(s){connection_uncertain(*out,s);return s;}return VEIL_STORE_OK;
}
veil_store_status ynx_server_listener_close(ynx_native_server_listener **p){
 if(!p)return VEIL_STORE_BOUND;if(!*p)return VEIL_STORE_OK;
 ynx_native_server_listener *l=listener_recognize(*p);if(!l)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(l->thread,pthread_self()))return VEIL_STORE_THREAD;if(l->children)return VEIL_STORE_FROZEN;
 if(l->fd>=0){int fd=l->fd;l->fd=-1;if(close(fd))return listener_uncertain(l,VEIL_STORE_UNKNOWN);}
 pthread_mutex_lock(&backend_lock);ynx_native_server_listener **link=&listener_inventory;while(*link&&*link!=l)link=&(*link)->next;
 if(*link!=l||!l->backend->listeners){pthread_mutex_unlock(&backend_lock);abort();}*link=l->next;l->backend->listeners--;pthread_mutex_unlock(&backend_lock);
 OPENSSL_cleanse(l,sizeof(*l));free(l);*p=NULL;return VEIL_STORE_OK;
}
veil_store_status ynx_server_execution_acquire(ynx_selected_server_backend *p,ynx_registered_native_connection *connection,ynx_original_bytes raw,uint64_t deadline,ynx_server_execution_attempt **out){
 if(!out||*out||!raw.data||raw.size<516||raw.size>4194384)return VEIL_STORE_BOUND;
 ynx_selected_server_backend *backend=backend_recognize(p);if(!backend)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(backend->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(backend->unknown)return VEIL_STORE_UNKNOWN;
 int32_t parsed=ynx_sdk_execution_original_validate_v1(raw.data,raw.size);if(parsed)return (veil_store_status)parsed;
 uint64_t mono=0,wall=0,issued=execution_be64(raw.data+452),expires=execution_be64(raw.data+460);
 if(!execution_time(&mono,&wall)||!deadline||deadline<=mono||wall<issued||wall>=expires)return VEIL_STORE_LIFETIME;
 uint64_t remaining=(expires-wall)*1000000u;
 if(remaining>UINT64_MAX-mono)return VEIL_STORE_BOUND;
 if(deadline>mono+remaining)deadline=mono+remaining;
 pthread_mutex_lock(&backend_lock);
 for(size_t n=0;n<backend->seen_count;n++){if(!memcmp(backend->seen_ids[n],raw.data+16,32)){pthread_mutex_unlock(&backend_lock);return VEIL_STORE_DUPLICATE;}}
 if(backend->seen_count==128){pthread_mutex_unlock(&backend_lock);return VEIL_STORE_FROZEN;}
 /* Recognition precedes dereference; a caller's SSL/opaque pointer is never
  * installed into an owner. Missing connection still leaves captured custody. */
 ynx_registered_native_connection *c=connection_inventory;while(c&&c!=connection)c=c->next;
 if(c&&(!pthread_equal(c->thread,pthread_self())||c->backend!=backend)){pthread_mutex_unlock(&backend_lock);return VEIL_STORE_MISMATCH;}
 if(c&&(!c->request_ready||raw.size!=c->body_size||memcmp(raw.data,c->incoming+c->header_size,raw.size))){pthread_mutex_unlock(&backend_lock);return VEIL_STORE_MISMATCH;}
 ynx_server_execution_attempt *h=calloc(1,sizeof(*h));
 if(h)h->request=malloc(raw.size);
 if(!h||!h->request){free(h);pthread_mutex_unlock(&backend_lock);return VEIL_STORE_SQL;}
 memcpy(h->request,raw.data,raw.size);h->request_size=raw.size;h->deadline_ns=deadline;h->thread=pthread_self();h->backend=backend;h->connection=c;
 h->next=execution_inventory;execution_inventory=h;memcpy(backend->seen_ids[backend->seen_count++],raw.data+16,32);backend->attempts++;if(c)c->attempts++;
 pthread_mutex_unlock(&backend_lock);*out=h;
 veil_store_status st=(veil_store_status)ynx_sdk_server_startup_current_v1(backend->startup,backend->role);
 if(st)return execution_uncertain(h,st);
 if(!execution_time(&mono,&wall)||mono>=deadline||wall<issued||wall>=expires)return execution_uncertain(h,VEIL_STORE_LIFETIME);
 if(!c){h->first=VEIL_STORE_REQUIRED;return VEIL_STORE_REQUIRED;}
 if(c->unknown)return execution_uncertain(h,c->first?c->first:VEIL_STORE_UNKNOWN);
 if(!c->handshake){h->first=VEIL_STORE_REQUIRED;return VEIL_STORE_REQUIRED;}
 st=ynx_server_connection_current(c);if(st)return execution_uncertain(h,c->first?c->first:st);
 /* A recognized transport is necessary but not a shared resource fence.
  * Admission remains unavailable until the original registry/state acquisition
  * has completed; no request/public floor creates that independent owner. */
 if(backend->first){h->first=backend->first;return backend->first;}
 return VEIL_STORE_OK;
}
veil_store_status ynx_server_execution_current(ynx_server_execution_attempt *p){
 ynx_server_execution_attempt *h=execution_recognize(p);if(!h)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(h->thread,pthread_self()))return VEIL_STORE_THREAD;if(h->unknown)return VEIL_STORE_UNKNOWN;
 if(h->backend->unknown)return execution_uncertain(h,h->backend->first?h->backend->first:VEIL_STORE_UNKNOWN);
 uint64_t mono=0,wall=0;if(!execution_time(&mono,&wall)||mono>=h->deadline_ns||wall<execution_be64(h->request+452)||wall>=execution_be64(h->request+460))return execution_uncertain(h,VEIL_STORE_LIFETIME);
 veil_store_status st=(veil_store_status)ynx_sdk_server_startup_current_v1(h->backend->startup,h->backend->role);if(st)return execution_uncertain(h,st);
 if(!execution_time(&mono,&wall)||mono>=h->deadline_ns||wall<execution_be64(h->request+452)||wall>=execution_be64(h->request+460))return execution_uncertain(h,VEIL_STORE_LIFETIME);
 if(h->connection&&h->connection->unknown)return execution_uncertain(h,h->connection->first?h->connection->first:VEIL_STORE_UNKNOWN);
 if(h->connection&&!h->connection->handshake)return VEIL_STORE_REQUIRED;
 if(h->connection){st=ynx_server_connection_current(h->connection);if(st)return execution_uncertain(h,h->connection->first?h->connection->first:st);}
 if(!execution_time(&mono,&wall)||mono>=h->deadline_ns||wall<execution_be64(h->request+452)||wall>=execution_be64(h->request+460))return execution_uncertain(h,VEIL_STORE_LIFETIME);
 return h->first?h->first:(!h->connection?VEIL_STORE_REQUIRED:VEIL_STORE_OK);
}
veil_store_status ynx_server_execution_original(ynx_server_execution_attempt *p,ynx_original_bytes *out){
 if(!out)return VEIL_STORE_BOUND;*out=(ynx_original_bytes){0};
 ynx_server_execution_attempt *h=execution_recognize(p);if(!h)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(h->thread,pthread_self()))return VEIL_STORE_THREAD;
 /* Readback of a failed original is permitted for exact-intent recovery only,
  * and does not clear UNKNOWN or authorize effect/replay. */
 *out=(ynx_original_bytes){h->request,h->request_size};return VEIL_STORE_OK;
}
veil_store_status ynx_server_execution_close(ynx_server_execution_attempt **p){
 if(!p)return VEIL_STORE_BOUND;if(!*p)return VEIL_STORE_OK;
 ynx_server_execution_attempt *h=execution_recognize(*p);if(!h)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(h->thread,pthread_self()))return VEIL_STORE_THREAD;if(h->borrows)return VEIL_STORE_FROZEN;
 /* An exchange child only borrows the backend-owned exact operation. Closing
  * this child does not retire the remote reservation or forget partial debt. */
 veil_store_status st=(veil_store_status)ynx_sdk_server_startup_current_v1(h->backend->startup,h->backend->role);
 if(st)execution_uncertain(h,st);
 /* Explicit disposal propagates uncertainty to the original backend. It is
  * not terminal adjudication and cannot reset a reservation or replay ledger. */
 if(h->unknown){if(!h->backend->first)h->backend->first=h->first;h->backend->unknown=1;}
 pthread_mutex_lock(&backend_lock);ynx_server_execution_attempt **link=&execution_inventory;while(*link&&*link!=h)link=&(*link)->next;
 if(*link!=h||!h->backend->attempts||(h->connection&&!h->connection->attempts)){pthread_mutex_unlock(&backend_lock);abort();}
 *link=h->next;h->backend->attempts--;if(h->connection)h->connection->attempts--;
 if(h->unknown){h->connection=NULL;h->next=h->backend->cleanup_attempts;h->backend->cleanup_attempts=h;pthread_mutex_unlock(&backend_lock);*p=NULL;return VEIL_STORE_UNKNOWN;}
 pthread_mutex_unlock(&backend_lock);
 OPENSSL_cleanse(h->request,h->request_size);free(h->request);OPENSSL_cleanse(h,sizeof(*h));free(h);*p=NULL;return VEIL_STORE_OK;
}
veil_store_status ynx_server_selected_backend_acquire(uint32_t role,ynx_selected_server_backend **out){
 if(!out||*out||(role!=1&&role!=2))return VEIL_STORE_BOUND;
 ynx_selected_server_backend *held=calloc(1,sizeof(*held));if(!held)return VEIL_STORE_SQL;
 held->thread=pthread_self();held->role=role;
 veil_store_status st=(veil_store_status)ynx_sdk_server_startup_borrow_v1(role,&held->startup);
 if(!held->startup){OPENSSL_cleanse(held,sizeof(*held));free(held);return st?st:VEIL_STORE_UNKNOWN;}
 pthread_mutex_lock(&backend_lock);held->next=backend_inventory;backend_inventory=held;pthread_mutex_unlock(&backend_lock);*out=held;
 if(st){held->first=st;held->unknown=st!=VEIL_STORE_REQUIRED;return st;}
 st=(veil_store_status)ynx_sdk_server_startup_current_v1(held->startup,role);
 if(st){held->first=st;held->unknown=1;return VEIL_STORE_UNKNOWN;}
 ynx_server_registered_original_borrow originals={0};
 st=(veil_store_status)ynx_sdk_server_registered_originals_borrow_v1(held->startup,&originals);
 if(st){if(!held->first)held->first=st;if(st!=VEIL_STORE_REQUIRED)held->unknown=1;return st;}
 if(!originals.association.data||!originals.registration.data||!originals.certificate.data||!originals.association.size||originals.association.size>65536||!originals.registration.size||originals.registration.size>65536||!originals.certificate.size||originals.certificate.size>16384||!originals.row.data||originals.row.size<28||originals.row.size>983128){held->first=VEIL_STORE_BOUND;held->unknown=1;return VEIL_STORE_BOUND;}
 size_t bytes=originals.association.size+originals.registration.size+originals.certificate.size+originals.row.size;
 held->registered_bytes=malloc(bytes);if(!held->registered_bytes){held->first=VEIL_STORE_SQL;return VEIL_STORE_SQL;}
 held->association_size=originals.association.size;held->registration_size=originals.registration.size;held->certificate_size=originals.certificate.size;held->row_size=originals.row.size;
 memcpy(held->registered_bytes,originals.association.data,held->association_size);memcpy(held->registered_bytes+held->association_size,originals.registration.data,held->registration_size);memcpy(held->registered_bytes+held->association_size+held->registration_size,originals.certificate.data,held->certificate_size);memcpy(held->resource_names,originals.names,sizeof(held->resource_names));memcpy(held->resource_kinds,originals.kinds,sizeof(held->resource_kinds));memcpy(held->registered_bytes+held->association_size+held->registration_size+held->certificate_size,originals.row.data,held->row_size);
 st=(veil_store_status)ynx_sdk_server_startup_current_v1(held->startup,role);if(st){if(!held->first)held->first=st;held->unknown=1;return VEIL_STORE_UNKNOWN;}
 /* Borrow THIS exclusive startup, without another global acquisition. Adopt
  * the partial administration child before classifying its late refusal. */
 st=ynx_administration_acquire(held->startup,role,originals.row,&held->administration);
 if(st){if(!held->first)held->first=st;if(st!=VEIL_STORE_REQUIRED)held->unknown=1;return held->unknown?VEIL_STORE_UNKNOWN:st;}
 st=ynx_administration_register_original(held->administration);
 if(st){if(!held->first)held->first=st;if(st!=VEIL_STORE_REQUIRED)held->unknown=1;return held->unknown?VEIL_STORE_UNKNOWN:st;}
 /* Resource custody alone is not atomic admitted registration readback. */
 if(!held->first)held->first=VEIL_STORE_REQUIRED;return VEIL_STORE_REQUIRED;
}
static int original_matches(ynx_original_bytes a,ynx_original_bytes b){return a.data&&b.data&&a.size==b.size&&!memcmp(a.data,b.data,a.size);}
veil_store_status ynx_server_selected_backend_transfer(uint32_t role,void **startup,ynx_original_bytes row,ynx_original_bytes association,ynx_original_bytes registration,ynx_selected_server_backend **out){
 if(!startup||!out||(void*)startup==(void*)out||!*startup||*out||(role!=1&&role!=2)||!row.data||row.size<28||row.size>983128||!association.data||!association.size||association.size>65536||!registration.data||!registration.size||registration.size>65536)return VEIL_STORE_BOUND;
 /* The Rust inventory recognizes the same worker/role/exclusive original;
  * this identity check never changes its first cause or confers admission. */
 veil_store_status st=(veil_store_status)ynx_sdk_server_startup_recognize_v1(*startup,role);if(st)return st;
 st=(veil_store_status)ynx_sdk_server_startup_current_v1(*startup,role);if(st)return st;
 ynx_server_registered_original_borrow originals={0};st=(veil_store_status)ynx_sdk_server_registered_originals_borrow_v1(*startup,&originals);if(st)return st;
 if(!original_matches(row,originals.row)||!original_matches(association,originals.association)||!original_matches(registration,originals.registration))return VEIL_STORE_MISMATCH;
 if(!originals.certificate.data||!originals.certificate.size||originals.certificate.size>16384)return VEIL_STORE_BOUND;
 size_t bytes=association.size+registration.size+originals.certificate.size+row.size;
 ynx_selected_server_backend *held=calloc(1,sizeof(*held));if(!held)return VEIL_STORE_SQL;
 held->registered_bytes=malloc(bytes);if(!held->registered_bytes){free(held);return VEIL_STORE_SQL;}
 held->thread=pthread_self();held->role=role;held->association_size=association.size;held->registration_size=registration.size;held->certificate_size=originals.certificate.size;held->row_size=row.size;
 memcpy(held->registered_bytes,association.data,association.size);memcpy(held->registered_bytes+association.size,registration.data,registration.size);memcpy(held->registered_bytes+association.size+registration.size,originals.certificate.data,originals.certificate.size);memcpy(held->registered_bytes+association.size+registration.size+originals.certificate.size,row.data,row.size);memcpy(held->resource_names,originals.names,sizeof(held->resource_names));memcpy(held->resource_kinds,originals.kinds,sizeof(held->resource_kinds));
 /* No foreign call/yield occurs between moving the original and publishing
  * partial custody. The same exclusive startup lease stays held throughout. */
 pthread_mutex_lock(&backend_lock);held->startup=*startup;*startup=NULL;held->next=backend_inventory;backend_inventory=held;*out=held;pthread_mutex_unlock(&backend_lock);
 st=(veil_store_status)ynx_sdk_server_startup_current_v1(held->startup,role);
 if(st){held->first=st;held->unknown=1;return VEIL_STORE_UNKNOWN;}
 st=ynx_administration_acquire(held->startup,role,(ynx_original_bytes){held->registered_bytes+held->association_size+held->registration_size+held->certificate_size,held->row_size},&held->administration);
 if(st){if(!held->first)held->first=st;if(st!=VEIL_STORE_REQUIRED)held->unknown=1;return held->unknown?VEIL_STORE_UNKNOWN:st;}
 st=ynx_administration_register_original(held->administration);
 if(st){if(!held->first)held->first=st;if(st!=VEIL_STORE_REQUIRED)held->unknown=1;return held->unknown?VEIL_STORE_UNKNOWN:st;}
 if(!held->first)held->first=VEIL_STORE_REQUIRED;return VEIL_STORE_REQUIRED;
}
veil_store_status ynx_server_selected_backend_original_current(ynx_selected_server_backend *p){
 ynx_selected_server_backend *held=backend_recognize(p);if(!held)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(held->thread,pthread_self()))return VEIL_STORE_THREAD;if(held->unknown)return VEIL_STORE_UNKNOWN;
 veil_store_status st=(veil_store_status)ynx_sdk_server_startup_current_v1(held->startup,held->role);
 if(st){if(!held->first)held->first=st;held->unknown=1;return VEIL_STORE_UNKNOWN;}
 if(held->administration){
  st=ynx_administration_current(held->administration);
  /* An unprovisioned child permits only the parent's original-facts loan.
   * Any actual late child refusal is retained, never replaced with OK. */
  if(st&&st!=VEIL_STORE_REQUIRED){if(!held->first)held->first=st;held->unknown=1;return VEIL_STORE_UNKNOWN;}
 }
 return VEIL_STORE_OK;
}
veil_store_status ynx_server_selected_backend_originals(ynx_selected_server_backend *p,ynx_server_registered_original_borrow *out){
 if(!out)return VEIL_STORE_BOUND;memset(out,0,sizeof(*out));
 veil_store_status st=ynx_server_selected_backend_original_current(p);if(st)return st;
 ynx_selected_server_backend *held=backend_recognize(p);if(!held||!held->registered_bytes)return VEIL_STORE_REQUIRED;
 ynx_server_registered_original_borrow original={0};original.association=(ynx_original_bytes){held->registered_bytes,held->association_size};original.registration=(ynx_original_bytes){held->registered_bytes+held->association_size,held->registration_size};original.certificate=(ynx_original_bytes){held->registered_bytes+held->association_size+held->registration_size,held->certificate_size};original.row=(ynx_original_bytes){held->registered_bytes+held->association_size+held->registration_size+held->certificate_size,held->row_size};memcpy(original.names,held->resource_names,sizeof(original.names));memcpy(original.kinds,held->resource_kinds,sizeof(original.kinds));
 st=ynx_server_selected_backend_original_current(p);if(st)return st;*out=original;return VEIL_STORE_OK;
}
veil_store_status ynx_server_selected_backend_close(ynx_selected_server_backend **p){
 if(!p)return VEIL_STORE_BOUND;if(!*p)return VEIL_STORE_OK;
 ynx_selected_server_backend *held=backend_recognize(*p);if(!held)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(held->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(held->listeners||held->connections||held->attempts)return VEIL_STORE_FROZEN;
 /* No live SSL borrower remains. Tear down secret-bearing SSL_CTX before the
  * selected sealed owner; failed owner cleanup retains this exact backend and
  * original pointer, and cannot be used for another transport acquisition. */
 if(held->server_context){SSL_CTX_free(held->server_context);held->server_context=NULL;}
 if(held->server_key){
  ynx_source_sealed_role_owner *original_key=held->server_key;
  veil_store_status key_status=transport_status(ynx_source_sealed_role_close(&held->server_key));
  /* This lower-level close explicitly permits UNKNOWN+NULL when it disposed
   * custody but reports prior uncertainty. Preserve that classification in
   * the backend; it is not permission to adopt a different live owner. */
  if(held->server_key&&held->server_key!=original_key)abort();
  if(key_status&& !held->server_key&&key_status!=VEIL_STORE_UNKNOWN)abort();
  if(key_status||held->server_key)return backend_transport_uncertain(held,key_status?key_status:VEIL_STORE_UNKNOWN);
 }
 while(held->operations){struct ynx_server_retained_operation*op=held->operations;
  if(op->executor){ynx_original_executor*original=op->executor;veil_store_status st=ynx_original_executor_close(&op->executor);if(op->executor&&op->executor!=original)abort();if(st&&!op->executor&&st!=VEIL_STORE_UNKNOWN)abort();if(st)backend_transport_uncertain(held,st);if(op->executor)return backend_transport_uncertain(held,st?st:VEIL_STORE_UNKNOWN);}
  held->operations=op->next;OPENSSL_cleanse(op,sizeof(*op));free(op);
 }
 if(held->administration){
  ynx_administration_owner *original_administration=held->administration;
  veil_store_status administration_status=ynx_administration_close(&held->administration);
  if(held->administration&&held->administration!=original_administration)abort();
  if(administration_status&&!held->administration&&administration_status!=VEIL_STORE_UNKNOWN)abort();
  if(administration_status)backend_transport_uncertain(held,administration_status);
  if(held->administration)return backend_transport_uncertain(held,administration_status?administration_status:VEIL_STORE_UNKNOWN);
 }
 void *original=held->startup;veil_store_status st=(veil_store_status)ynx_sdk_server_startup_release_v1(&held->startup);
 if((st||held->startup)&&held->startup!=original)abort();
 if(st||held->startup){if(!held->first)held->first=st?st:VEIL_STORE_UNKNOWN;held->unknown=1;return st?st:VEIL_STORE_UNKNOWN;}
 pthread_mutex_lock(&backend_lock);ynx_selected_server_backend **link=&backend_inventory;while(*link&&*link!=held)link=&(*link)->next;
 if(*link!=held){pthread_mutex_unlock(&backend_lock);abort();}*link=held->next;pthread_mutex_unlock(&backend_lock);
 int unresolved=held->unknown;
 while(held->cleanup_attempts){ynx_server_execution_attempt *h=held->cleanup_attempts;held->cleanup_attempts=h->next;OPENSSL_cleanse(h->request,h->request_size);free(h->request);OPENSSL_cleanse(h,sizeof(*h));free(h);}
 if(held->registered_bytes){OPENSSL_cleanse(held->registered_bytes,held->association_size+held->registration_size+held->certificate_size+held->row_size);free(held->registered_bytes);}OPENSSL_cleanse(held,sizeof(*held));free(held);*p=NULL;return unresolved?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
veil_store_status ynx_server_execution_execute(ynx_server_execution_attempt*p){
 ynx_server_execution_attempt*h=execution_recognize(p);if(!h)return VEIL_STORE_REQUIRED;if(!pthread_equal(h->thread,pthread_self()))return VEIL_STORE_THREAD;if(h->executed)return h->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_DUPLICATE;
 if(!h->connection||!h->connection->request_ready||h->request_size!=h->connection->body_size||memcmp(h->request,h->connection->incoming+h->connection->header_size,h->request_size))return execution_uncertain(h,VEIL_STORE_MISMATCH);
 if(h->unknown||h->backend->unknown)return execution_uncertain(h,h->first?h->first:VEIL_STORE_UNKNOWN);
 veil_store_status s=ynx_server_connection_current(h->connection);if(s)return execution_uncertain(h,s);
 /* A previously unadmitted backend permits acquisition preflight only. Its
  * administration inventory/current independently selects actual resources;
  * this exception does not permit effects through a Required business owner. */
 unsigned action=be16(h->request+10);h->executed=1;
 if(action==1){
  unsigned char zero[32]={0};if(CRYPTO_memcmp(h->request+48,zero,32))s=VEIL_STORE_MISMATCH;
  else if(!h->backend->administration)s=VEIL_STORE_REQUIRED;
  else{struct ynx_server_retained_operation*op=calloc(1,sizeof(*op));if(!op)s=VEIL_STORE_SQL;
   else{if(!SHA256(h->request,h->request_size,op->reference)){free(op);s=VEIL_STORE_UNKNOWN;}
    else{memcpy(op->constraints,h->request+80,sizeof(op->constraints));op->deadline=h->deadline_ns;
     op->next=h->backend->operations;h->backend->operations=op;h->operation=op;
     /* Backend retains reference/request-bound partial BEFORE acquisition. */
     s=ynx_original_executor_acquire(h->backend->administration,(ynx_original_bytes){h->request,h->request_size},h->deadline_ns,&op->executor);
     if(s){op->first=s;op->unknown=s!=VEIL_STORE_REQUIRED;}
    }
   }
  }
 }else{
  struct ynx_server_retained_operation*op=h->backend->operations;while(op&&CRYPTO_memcmp(op->reference,h->request+48,32))op=op->next;
  if(!op||CRYPTO_memcmp(op->constraints,h->request+80,sizeof(op->constraints)))s=VEIL_STORE_MISMATCH;
  else{h->operation=op;
   if(action==7){unsigned sub=h->request[516];
    if(sub==0){ynx_executor_phase observed=0;s=op->executor?ynx_original_executor_observe(op->executor,&observed):(op->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_REQUIRED);}
    else if(sub==1){if(op->closed)s=op->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_DUPLICATE;
     else if(!op->executor){op->closed=1;s=op->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_REQUIRED;}
     else{ynx_original_executor*original=op->executor;s=ynx_original_executor_close(&op->executor);if(op->executor&&op->executor!=original)abort();if(s&&!op->executor&&s!=VEIL_STORE_UNKNOWN)abort();if(!op->executor)op->closed=1;}
    }else s=VEIL_STORE_BOUND;
   }else if(op->unknown||op->closed)s=VEIL_STORE_UNKNOWN;
   else if(action==2)s=ynx_original_executor_current(op->executor);
   else if(action==6){
    s=(veil_store_status)ynx_sdk_server_retirement_originals_verify_v1(h->backend->startup,h->backend->role,h->request,h->request_size);
    /* Valid public chains still cannot turn this registry CAS into the actual
     * device core/journal commit or construct the independent terminal owner. */
    if(!s)s=VEIL_STORE_REQUIRED;
   }
   else s=VEIL_STORE_REQUIRED;/* same owning effect/terminal consumption next */
   if(s&&!op->first)op->first=s;if(s&&s!=VEIL_STORE_REQUIRED)op->unknown=1;
  }
 }
 if(s&&s!=VEIL_STORE_REQUIRED)execution_uncertain(h,s);
 /* This response holds only truthful unresolved state until a genuine owned
  * observation has been built. An acquired local executor is not a complete
  * unsigned wire Observation and must not produce status0/empty success. */
 if(!s)s=VEIL_STORE_REQUIRED;
 memset(h->response,0,sizeof(h->response));memcpy(h->response,"YNXEXE1\0",8);put16(h->response+8,1);put16(h->response+10,(uint16_t)action);memcpy(h->response+12,h->request+16,32);if(h->operation)memcpy(h->response+44,h->operation->reference,32);put32(h->response+76,(uint32_t)s);put32(h->response+80,0);h->response_ready=1;
 return h->unknown?VEIL_STORE_UNKNOWN:s;
}
veil_store_status ynx_server_execution_response(ynx_server_execution_attempt*p,ynx_original_bytes*out){
 if(!out)return VEIL_STORE_BOUND;*out=(ynx_original_bytes){0};ynx_server_execution_attempt*h=execution_recognize(p);if(!h)return VEIL_STORE_REQUIRED;if(!pthread_equal(h->thread,pthread_self()))return VEIL_STORE_THREAD;if(!h->response_ready)return VEIL_STORE_REQUIRED;
 *out=(ynx_original_bytes){h->response,sizeof(h->response)};return VEIL_STORE_OK;/* same failure original, no plaintext/capability */
}
