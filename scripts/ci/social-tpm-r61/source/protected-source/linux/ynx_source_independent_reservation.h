#ifndef YNX_SOURCE_INDEPENDENT_RESERVATION_H
#define YNX_SOURCE_INDEPENDENT_RESERVATION_H
#include "ynx_source_platform_qualified.h"
/* Private persisted state, NOT a public floor or admission projection. Only
 * the server's retained storage/current/floor owners may consume the decoded
 * state. Canonical decode alone never creates one of those owners. */
#define YNX_INDEPENDENT_STATE_BYTES 248u
typedef struct ynx_independent_original_state {
 uint64_t generation,sequence,counter,floor;
 unsigned char head[32],checkpoint[32],registration[32],request[32],nonce[32];
 unsigned char ciphertext_digest[32];
 uint32_t phase;
} ynx_independent_original_state;
/* Both use the SAME selected private storage envelope/AAD/key-global nonce.
 * No fresh state constructor; an unknown old blob is never silently migrated.
 * Locking sink custody is required before authenticated private decrypt. */
veil_store_status ynx_independent_state_open(const unsigned char key[32],const ynx_storage_expected *,ynx_original_bytes,unsigned char *locked_sink,size_t,ynx_independent_original_state *);
veil_store_status ynx_independent_state_seal(const unsigned char key[32],const ynx_storage_expected *,const ynx_independent_original_state *,ynx_storage_ciphertext *);
/* Exact canonical state consistency, not genuine latest-head/floor admission.
 * phase1 RESERVED persists the original request/nonce BEFORE any effect;
 * phase2 ENTERED and phase3 UNKNOWN are never reset/re-reserved on recovery. */
veil_store_status ynx_independent_state_match(const ynx_independent_original_state *,const ynx_storage_expected *);
/* Nonce-independent private allocator journal. Mathematical MAC verification
 * alone does not construct an allocation owner or prove latest-head/floor.
 * The caller must hold the DISTINCT admitted integrity-key/current/fence owner.
 * Phases: 1 durable intent, 2 entered burn, 3 independently adjudicated burn,
 * 4 UNKNOWN. Recovery may observe phases but must never reset/replay them. */
#define YNX_ALLOCATOR_JOURNAL_BYTES 288u
typedef struct ynx_allocator_journal {
 uint32_t epoch,phase;uint64_t key_generation,ordinal,sequence,floor,deadline;
 unsigned char allocator[32],key_identity[32],intent[32],head[32],registration[32],predecessor[32];
} ynx_allocator_journal;
veil_store_status ynx_allocator_journal_encode(const unsigned char integrity_key[32],const ynx_allocator_journal *,unsigned char out[YNX_ALLOCATOR_JOURNAL_BYTES]);
veil_store_status ynx_allocator_journal_decode(const unsigned char integrity_key[32],ynx_original_bytes,const ynx_allocator_journal *expected,ynx_allocator_journal *out);
/* A phase transition is persisted-state consistency ONLY. The original
 * authority-bearing decision is separately acquired by the administration
 * owner. No ordinal is assigned here and no transition yields a nonce. The
 * complete previous MAC original is consumed, not a caller predecessor hash. */
veil_store_status ynx_allocator_journal_transition(const unsigned char integrity_key[32],ynx_original_bytes previous_original,const ynx_allocator_journal *previous,const unsigned char exact_intent[32],uint32_t next_phase,ynx_allocator_journal *next);
/* Domain execution ledger (private, distinct from allocator journal). A codec
 * authenticates bytes only; callers must hold the registered domain resources. */
#define YNX_DOMAIN_STATE_BYTES 352u
typedef struct ynx_domain_state {
 uint32_t phase,epoch;uint64_t generation,ordinal,sequence,floor,deadline;
 unsigned char domain[32],key_identity[32],intent[32],head[32],registration[32],ciphertext[32],predecessor[32],product_catalog[32];
} ynx_domain_state;
veil_store_status ynx_domain_state_encode(const unsigned char[32],const ynx_domain_state *,unsigned char[YNX_DOMAIN_STATE_BYTES]);
veil_store_status ynx_domain_state_decode(const unsigned char[32],ynx_original_bytes,ynx_domain_state *);
#endif
