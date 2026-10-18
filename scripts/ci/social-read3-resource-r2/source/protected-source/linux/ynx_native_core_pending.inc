#include "../android/ynx_native_core_binding.h"
/* Local durable intent mechanics for the existing NativeCore resource owner.
 * NOT a domain fence, key authority, terminal receipt or device grant.
 * Caller must own the true policy/resource fence before calling these APIs.
 * Existing authenticated domain bytes are used unchanged; no new wire crypto.
 */
#include "ynx_source_independent_reservation.h"
#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/crypto.h>
#include <openssl/sha.h>
struct ynx_native_core_pending {
 pthread_t thread;int dir,fd,unknown,attempted,close_failed;
 unsigned char original[YNX_DOMAIN_STATE_BYTES];
 ynx_domain_state state;int loaded;
 struct ynx_native_core_pending *next;
};
static pthread_mutex_t pending_lock=PTHREAD_MUTEX_INITIALIZER;
static ynx_native_core_pending *pending_inventory;
static const char pending_name[]="core-pending.v2";
static ynx_native_core_pending *pending_find(ynx_native_core_pending *p){
 pthread_mutex_lock(&pending_lock);ynx_native_core_pending *q=pending_inventory;
 while(q&&q!=p)q=q->next;
 pthread_mutex_unlock(&pending_lock);
 return q;
}
static veil_store_status pending_bad(ynx_native_core_pending *q){
 q->unknown=1;return VEIL_STORE_UNKNOWN;
}
static int pending_directory(int fd){
 struct stat s;return !fstat(fd,&s)&&S_ISDIR(s.st_mode)&&s.st_uid==geteuid()&&(s.st_mode&0777)==0700;
}
static int pending_path(ynx_native_core_pending *q){
 struct stat a,b;
 return pending_directory(q->dir)&&q->fd>=0&&!fstat(q->fd,&a)&&
 !fstatat(q->dir,pending_name,&b,AT_SYMLINK_NOFOLLOW)&&S_ISREG(a.st_mode)&&
 S_ISREG(b.st_mode)&&a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&
 a.st_uid==geteuid()&&(a.st_mode&0777)==0600&&a.st_nlink==1;
}
static int pending_read_exact(int fd,unsigned char *out,size_t n,off_t at){
 size_t done=0;while(done<n){
  ssize_t got=pread(fd,out+done,n-done,at+(off_t)done);
  if(got<0&&errno==EINTR)continue;
  if(got<=0)return 0;
  done+=(size_t)got;
 }return 1;
}
static int pending_write_exact(int fd,const unsigned char *in,size_t n,off_t at){
 size_t done=0;while(done<n){
  ssize_t put=pwrite(fd,in+done,n-done,at+(off_t)done);
  if(put<0&&errno==EINTR)continue;
  if(put<=0)return 0;
  done+=(size_t)put;
 }return 1;
}
/* Authenticate exact next bytes while preserving all original bindings.
 * This phase-2 marker is durable BEFORE burn; it is never burn completion. */
static veil_store_status pending_next(const unsigned char key[32],
 const unsigned char previous[YNX_DOMAIN_STATE_BYTES],const ynx_domain_state *s,
 const unsigned char next[YNX_DOMAIN_STATE_BYTES],ynx_domain_state *out){
 if(s->phase!=1||s->sequence==UINT64_MAX)return VEIL_STORE_FROZEN;
 ynx_domain_state old={0};
 veil_store_status st=ynx_domain_state_decode(key,(ynx_original_bytes){previous,YNX_DOMAIN_STATE_BYTES},&old);
 if(st)return st;
 unsigned char exact[YNX_DOMAIN_STATE_BYTES];
 st=ynx_domain_state_encode(key,s,exact);
 if(st||CRYPTO_memcmp(exact,previous,sizeof(exact))){
  OPENSSL_cleanse(exact,sizeof(exact));OPENSSL_cleanse(&old,sizeof(old));
  return st?st:VEIL_STORE_MISMATCH;
 }
 ynx_domain_state wanted=old;wanted.phase=2;wanted.sequence++;
 if(!SHA256(previous,YNX_DOMAIN_STATE_BYTES,wanted.predecessor))st=VEIL_STORE_UNKNOWN;
 else st=ynx_domain_state_encode(key,&wanted,exact);
 if(!st&&CRYPTO_memcmp(exact,next,sizeof(exact)))st=VEIL_STORE_MISMATCH;
 if(!st)*out=wanted;
 OPENSSL_cleanse(exact,sizeof(exact));OPENSSL_cleanse(&old,sizeof(old));
 OPENSSL_cleanse(&wanted,sizeof(wanted));return st;
}
static veil_store_status pending_open(int dir,int create,ynx_native_core_pending **out){
 if(!out||*out||!pending_directory(dir))return VEIL_STORE_BOUND;
 ynx_native_core_pending *q=calloc(1,sizeof(*q));if(!q)return VEIL_STORE_SQL;
 q->dir=fcntl(dir,F_DUPFD_CLOEXEC,3);q->fd=-1;
 if(q->dir<0){free(q);return VEIL_STORE_SQL;}q->thread=pthread_self();
 pthread_mutex_lock(&pending_lock);q->next=pending_inventory;pending_inventory=q;*out=q;pthread_mutex_unlock(&pending_lock);
 q->fd=openat(q->dir,pending_name,O_RDWR|O_NOFOLLOW|O_CLOEXEC|(create?(O_CREAT|O_EXCL):0),0600);
 if(q->fd<0)return create&&errno==EEXIST?VEIL_STORE_DUPLICATE:VEIL_STORE_REQUIRED;
 if(flock(q->fd,LOCK_EX|LOCK_NB))return VEIL_STORE_FROZEN;
 if(!pending_path(q))return pending_bad(q);
 return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_pending_create(int dir,const unsigned char key[32],
 ynx_original_bytes raw,ynx_native_core_pending **out){
 if(!key||!raw.data||raw.size!=YNX_DOMAIN_STATE_BYTES||!out||*out)return VEIL_STORE_BOUND;
 ynx_domain_state state={0};veil_store_status st=ynx_domain_state_decode(key,raw,&state);
 if(st)return st;
 if(state.phase!=1)return VEIL_STORE_MISMATCH;
 st=pending_open(dir,1,out);if(st)return st;ynx_native_core_pending *q=*out;
 /* The name is now durable pending custody even on any following failure. */
 q->attempted=1;
 if(!pending_write_exact(q->fd,raw.data,raw.size,0)||fsync(q->fd)||fsync(q->dir))
  return pending_bad(q);
 struct stat s;unsigned char readback[YNX_DOMAIN_STATE_BYTES];
 if(!pending_path(q)||fstat(q->fd,&s)||s.st_size!=YNX_DOMAIN_STATE_BYTES||
  !pending_read_exact(q->fd,readback,sizeof(readback),0)||
  CRYPTO_memcmp(readback,raw.data,sizeof(readback))){
  OPENSSL_cleanse(readback,sizeof(readback));return pending_bad(q);
 }
 memcpy(q->original,readback,sizeof(readback));OPENSSL_cleanse(readback,sizeof(readback));
 q->state=state;q->loaded=1;q->attempted=0;return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_pending_restore(int dir,const unsigned char key[32],
 ynx_native_core_pending **out){
 if(!key||!out||*out)return VEIL_STORE_BOUND;
 veil_store_status st=pending_open(dir,0,out);if(st)return st;
 ynx_native_core_pending *q=*out;struct stat s;
 if(fstat(q->fd,&s)||(s.st_size!=YNX_DOMAIN_STATE_BYTES&&s.st_size!=2*YNX_DOMAIN_STATE_BYTES))return pending_bad(q);
 unsigned char first[YNX_DOMAIN_STATE_BYTES],second[YNX_DOMAIN_STATE_BYTES];
 if(!pending_read_exact(q->fd,first,sizeof(first),0))return pending_bad(q);
 ynx_domain_state state={0};st=ynx_domain_state_decode(key,(ynx_original_bytes){first,sizeof(first)},&state);
 if(st||state.phase!=1){OPENSSL_cleanse(first,sizeof(first));return pending_bad(q);}
 if(s.st_size==2*YNX_DOMAIN_STATE_BYTES){
  if(!pending_read_exact(q->fd,second,sizeof(second),YNX_DOMAIN_STATE_BYTES))st=VEIL_STORE_UNKNOWN;
  else {ynx_domain_state entered={0};st=pending_next(key,first,&state,second,&entered);if(!st){state=entered;memcpy(first,second,sizeof(first));}OPENSSL_cleanse(&entered,sizeof(entered));}
 }
 OPENSSL_cleanse(second,sizeof(second));
 if(st||!pending_path(q)){OPENSSL_cleanse(first,sizeof(first));return pending_bad(q);}
 q->state=state;memcpy(q->original,first,sizeof(first));q->loaded=1;q->attempted=state.phase==2;
 OPENSSL_cleanse(first,sizeof(first));return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_pending_enter(ynx_native_core_pending *p,
 const unsigned char key[32],ynx_original_bytes next){
 if(!key||!next.data||next.size!=YNX_DOMAIN_STATE_BYTES)return VEIL_STORE_BOUND;
 ynx_native_core_pending *q=pending_find(p);if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->unknown||q->close_failed)return VEIL_STORE_UNKNOWN;
 if(!q->loaded)return VEIL_STORE_REQUIRED;
 if(q->attempted||q->state.phase!=1)return VEIL_STORE_DUPLICATE;
 ynx_domain_state entered={0};veil_store_status st=pending_next(key,q->original,&q->state,next.data,&entered);
 if(st)return st;
 struct stat s;unsigned char prior[YNX_DOMAIN_STATE_BYTES];
 if(!pending_path(q)||fstat(q->fd,&s)||s.st_size!=YNX_DOMAIN_STATE_BYTES||
  !pending_read_exact(q->fd,prior,sizeof(prior),0)||CRYPTO_memcmp(prior,q->original,sizeof(prior))){
  OPENSSL_cleanse(prior,sizeof(prior));return pending_bad(q);
 }
 OPENSSL_cleanse(prior,sizeof(prior));q->attempted=1;
 if(!pending_write_exact(q->fd,next.data,next.size,YNX_DOMAIN_STATE_BYTES)||fsync(q->fd))
  return pending_bad(q);
 unsigned char after[YNX_DOMAIN_STATE_BYTES];
 if(!pending_path(q)||fstat(q->fd,&s)||s.st_size!=2*YNX_DOMAIN_STATE_BYTES||
  !pending_read_exact(q->fd,after,sizeof(after),YNX_DOMAIN_STATE_BYTES)||
  CRYPTO_memcmp(after,next.data,sizeof(after))){
  OPENSSL_cleanse(after,sizeof(after));return pending_bad(q);
 }
 memcpy(q->original,after,sizeof(after));OPENSSL_cleanse(after,sizeof(after));q->state=entered;
 return VEIL_STORE_OK;
}
/* Observation only, including phase 2; never permission to repeat a burn. */
veil_store_status ynx_native_core_pending_observe(ynx_native_core_pending *p,uint32_t *phase){
 if(!phase)return VEIL_STORE_BOUND;
 *phase=0;
 ynx_native_core_pending *q=pending_find(p);if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->loaded)*phase=q->state.phase;
 return q->unknown?VEIL_STORE_UNKNOWN:q->loaded?VEIL_STORE_OK:VEIL_STORE_REQUIRED;
}
veil_store_status ynx_native_core_pending_close(ynx_native_core_pending **slot){
 if(!slot)return VEIL_STORE_BOUND;
 if(!*slot)return VEIL_STORE_OK;
 ynx_native_core_pending *q=pending_find(*slot);if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->close_failed)return VEIL_STORE_UNKNOWN;
 if(q->fd>=0){int fd=q->fd;q->fd=-1;if(close(fd)){q->close_failed=1;return pending_bad(q);}}
 if(q->dir>=0){int fd=q->dir;q->dir=-1;if(close(fd)){q->close_failed=1;return pending_bad(q);}}
 pthread_mutex_lock(&pending_lock);ynx_native_core_pending **link=&pending_inventory;
 while(*link&&*link!=q)link=&(*link)->next;
 if(*link!=q){pthread_mutex_unlock(&pending_lock);abort();}
 *link=q->next;pthread_mutex_unlock(&pending_lock);
 int unknown=q->unknown;OPENSSL_cleanse(q,sizeof(*q));free(q);*slot=NULL;
 return unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}

/* Readback of retained staging facts only. No key use, floor or grant follows
 * from this comparison. Do not refresh or replace the original operation. */
veil_store_status ynx_native_core_pending_matches(ynx_native_core_pending *p,
 const struct ynx_native_core_enforcing_binding_v2 *binding){
 if(!binding||binding->version!=2||binding->purpose<1||binding->purpose>2||
  !binding->storage_generation||!binding->policy_generation||!binding->deadline)
  return VEIL_STORE_BOUND;
 ynx_native_core_pending *q=pending_find(p);if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->unknown||q->close_failed)return VEIL_STORE_UNKNOWN;
 if(!q->loaded)return VEIL_STORE_REQUIRED;
 if(q->state.generation!=binding->storage_generation||q->state.floor!=binding->floor||
  q->state.deadline!=binding->deadline||
  CRYPTO_memcmp(q->state.intent,binding->intent,32)||
  CRYPTO_memcmp(q->state.head,binding->head,32)||
  CRYPTO_memcmp(q->state.registration,binding->registration,32))return VEIL_STORE_MISMATCH;
 struct stat st;unsigned char last[YNX_DOMAIN_STATE_BYTES],first[YNX_DOMAIN_STATE_BYTES],digest[32];
 off_t offset=q->state.phase==2?YNX_DOMAIN_STATE_BYTES:0;
 int valid=pending_path(q)&&!fstat(q->fd,&st)&&
  st.st_size==offset+YNX_DOMAIN_STATE_BYTES&&
  pending_read_exact(q->fd,last,sizeof(last),offset)&&
  !CRYPTO_memcmp(last,q->original,sizeof(last));
 if(valid&&offset)valid=pending_read_exact(q->fd,first,sizeof(first),0)&&
  SHA256(first,sizeof(first),digest)&&!CRYPTO_memcmp(digest,q->state.predecessor,32);
 OPENSSL_cleanse(first,sizeof(first));OPENSSL_cleanse(last,sizeof(last));OPENSSL_cleanse(digest,sizeof(digest));
 return valid?VEIL_STORE_OK:pending_bad(q);
}

/* Validate both domain records before either enters. This reads actual retained
 * bytes but does not confer authority, advance a phase, or cache a permission. */
veil_store_status ynx_native_core_pending_validate_enter(ynx_native_core_pending *p,
 const unsigned char key[32],ynx_original_bytes next){
 if(!key||!next.data||next.size!=YNX_DOMAIN_STATE_BYTES)return VEIL_STORE_BOUND;
 ynx_native_core_pending *q=pending_find(p);if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->unknown||q->close_failed)return VEIL_STORE_UNKNOWN;
 if(!q->loaded)return VEIL_STORE_REQUIRED;
 if(q->attempted||q->state.phase!=1)return VEIL_STORE_DUPLICATE;
 ynx_domain_state entered={0};
 veil_store_status s=pending_next(key,q->original,&q->state,next.data,&entered);
 OPENSSL_cleanse(&entered,sizeof(entered));if(s)return s;
 struct stat st;unsigned char before[YNX_DOMAIN_STATE_BYTES];
 int valid=pending_path(q)&&!fstat(q->fd,&st)&&st.st_size==YNX_DOMAIN_STATE_BYTES&&
  pending_read_exact(q->fd,before,sizeof(before),0)&&
  !CRYPTO_memcmp(before,q->original,sizeof(before));
 OPENSSL_cleanse(before,sizeof(before));
 return valid?VEIL_STORE_OK:pending_bad(q);
}
