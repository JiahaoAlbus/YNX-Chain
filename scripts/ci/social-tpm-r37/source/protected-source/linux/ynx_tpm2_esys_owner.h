#ifndef YNX_TPM2_ESYS_OWNER_H
#define YNX_TPM2_ESYS_OWNER_H
/* Private TPM primitive, NOT a qualified Source/enrollment constructor. Configuration
 * must originate in the independently verified platform owner. This layer verifies
 * the named TPM resources; matching these bytes alone does not establish authority. */
#include <stddef.h>
#include <stdint.h>
#include <tss2_esys.h>
typedef struct ynx_tpm2_owner ynx_tpm2_owner;
typedef struct ynx_tpm2_command_authorizer ynx_tpm2_command_authorizer;
enum ynx_tpm2_result { YNX_TPM2_OK=0, YNX_TPM2_REQUIRED=1,
    YNX_TPM2_REFUSED=2, YNX_TPM2_RESOURCE=3, YNX_TPM2_UNKNOWN=5 };
typedef struct {
    const char *device; /* only explicit /dev/tpmrm0 or /dev/tpm0; no loader/env */
    TPM2_HANDLE sealed_object, salt_key, attestation_key, counter;
    TPM2B_NAME object_name, salt_name, ak_name, counter_name, ak_qualified_name;
    TPM2B_DIGEST object_policy, counter_policy, pcr_digest;
    TPML_PCR_SELECTION pcrs;
    uint64_t expected_counter;
    uint64_t monotonic_deadline_ns; /* fixed operation budget, never renewed */
} ynx_tpm2_resource_selection;
/* DISTINCT non-exportable platform command-signing objects, NOT Source role
 * keys, AK, storage/integrity material or administration admission. Private
 * qualified provisioning supplies these exact original selections. This
 * primitive cannot certify the domain label or sole-writer registration. */
typedef struct {
 const char *device; TPM2_HANDLE key;
 TPM2B_PUBLIC original_public; TPM2B_NAME original_name;
 TPM2B_DIGEST signing_policy,pcr_digest; TPML_PCR_SELECTION pcrs;
 TPM2B_NONCE registered_policy_ref;
 unsigned char administration_domain[32]; uint64_t monotonic_deadline_ns;
} ynx_tpm2_command_authorizer_selection;
/* The parent holds this DISTINCT original command-auth owner until child close.
 * Secret bytes never enter the selection/public caller. Its actual locked borrow
 * is used only within PCR+PolicyAuthValue; no password authorization fallback. */
int ynx_tpm2_command_authorizer_open(const ynx_tpm2_command_authorizer_selection *,ynx_tpm2_owner *original_command_auth,ynx_tpm2_command_authorizer **);
int ynx_tpm2_command_authorizer_current(ynx_tpm2_command_authorizer *);
int ynx_tpm2_command_authorizer_close(ynx_tpm2_command_authorizer **);
/* On any partial acquisition failure *out retains the resource owner for close.
 * Success is primitive readiness only. No software enrollment/admission out. */
int ynx_tpm2_owner_open(const ynx_tpm2_resource_selection *, ynx_tpm2_owner **out);
int ynx_tpm2_owner_current(ynx_tpm2_owner *);
/* Irreversible local denial only. Does not acquire a Core guard or resource. */
int ynx_tpm2_owner_deny_raw_secret(ynx_tpm2_owner *);
int ynx_tpm2_owner_unseal(ynx_tpm2_owner *);
/* Same-thread read-only locked-memory borrow; must release before cleanup. */
int ynx_tpm2_owner_secret_borrow(ynx_tpm2_owner *, const uint8_t **, size_t *);
int ynx_tpm2_owner_secret_release(ynx_tpm2_owner *);
/* Cancellation/uncertainty cannot be reset. A mutation attempt is at most once.
 * OK is NOT terminal; independently verify certification/retirement externally. */
int ynx_tpm2_owner_cancel(ynx_tpm2_owner *);
int ynx_tpm2_owner_increment_once(ynx_tpm2_owner *);
/* Both recognized original authorizer owners sign internally. There is no raw
 * signature/password/callback installer. Final PCR+Signed+Signed policy must
 * equal the actual NV authPolicy before once mutation. The upper qualified
 * owner must ALSO hold its independent exclusive/current/revoke decision;
 * PolicySigned success alone is not reservation/floor/terminal authority. */
int ynx_tpm2_owner_increment_signed_once(ynx_tpm2_owner *,ynx_tpm2_command_authorizer *,ynx_tpm2_command_authorizer *);
/* Partial attestation/signature outputs are caller-owned Esys_Free allocations
 * even on refusal/UNKNOWN. They are UNVERIFIED observations, never terminal. */
int ynx_tpm2_owner_certify(ynx_tpm2_owner *, const TPM2B_DATA *,
                         TPM2B_ATTEST **, TPMT_SIGNATURE **);
/* Fresh same-original observation only. Partial ESAPI allocations remain caller
 * owned even on failure; this cannot establish signature validity/admission. */
int ynx_tpm2_owner_quote(ynx_tpm2_owner *, const TPM2B_DATA *,
                       TPM2B_ATTEST **, TPMT_SIGNATURE **);
/* Failure retains *owner. Successful disposal clears it (OK or UNKNOWN); UNKNOWN remains unresolved.
 * Neither return means durable retirement. */
int ynx_tpm2_owner_close(ynx_tpm2_owner **owner);
TSS2_RC ynx_tpm2_owner_first_cause(const ynx_tpm2_owner *);
/* Same original entered counter: cryptographically verify its original NV
 * certificate using the named enrolled AK, AND re-read the actual counter.
 * This observes one successful increment; it never clears owner uncertainty,
 * renews a deadline, authorizes a caller, or provides independent finality.
 * Partial ESAPI allocations remain caller-owned on all returns. */
int ynx_tpm2_owner_increment_observed_current(ynx_tpm2_owner *,
 const unsigned char challenge[32],TPM2B_ATTEST **,TPMT_SIGNATURE **);

/* Physical dual post-increment observation only. Same existing admitted server
 * must retain the purpose/terminal/joint fence. No UNKNOWN reset or grant. */
int ynx_tpm2_pair_retired_observed_current(ynx_tpm2_owner *,ynx_tpm2_owner *,
 const unsigned char issuer_challenge[32],const unsigned char anchor_challenge[32]);

struct ynx_storage_expected;struct ynx_storage_ciphertext;
int ynx_tpm2_owner_storage_seal(ynx_tpm2_owner *,const unsigned char key_identity[32],
 const struct ynx_storage_expected *,const unsigned char *,size_t,
 struct ynx_storage_ciphertext *);
/* Private keyed product-record index only; no key/authority is returned.
 * Actual caller must already hold current same registered-store read/write q. */
int ynx_tpm2_owner_product_selector_v1(ynx_tpm2_owner *,const unsigned char key_identity[32],const unsigned char store_reference[32],uint64_t generation,uint32_t namespace_id,const unsigned char *id,size_t id_size,unsigned char out[32]);
/* Actual same storage-key producer; no exported secret. Caller retains every
 * nonnull ciphertext on late refusal and must not encrypt again. */
#include "ynx_native_product_cipher_private.h"
int ynx_tpm2_owner_product_seal_v1(ynx_tpm2_owner *,const unsigned char key_identity[32],const ynx_product_cipher_expected_v1 *,const unsigned char *,size_t,ynx_storage_ciphertext *);
int ynx_tpm2_owner_product_open_v1(ynx_tpm2_owner *,const unsigned char key_identity[32],const ynx_product_cipher_expected_v1 *,const unsigned char *,size_t,unsigned char *,size_t,size_t *);
#endif

