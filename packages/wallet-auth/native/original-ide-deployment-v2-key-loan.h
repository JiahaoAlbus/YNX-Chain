#pragma once
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Source-owned private ABI. Never exported as JS buffers or generic signer.
 * Context is the digest of the SAME admitted fullRef/epochs/tenant/project/
 * resource/approval/payload binding and original Source current selection.
 * Caller-supplied context alone cannot select a Root row or key path. */
typedef struct YNXIDEDeploymentV2KeyLoan YNXIDEDeploymentV2KeyLoan;
typedef struct {
 uint32_t version,size;
 uint8_t source_scope_sha256[32],approved_payload_sha3_512[64],approved_payload_sha512[64];
 uint64_t payload_bytes,publisher_epoch,issuer_epoch,source_generation,source_sequence,source_floor;
 uint64_t not_before_ms,expires_ms;
} YNXIDEDeploymentV2LoanContext;
typedef struct {
 const uint8_t *pkcs8_a;size_t pkcs8_a_bytes;
 const uint8_t *pkcs8_b;size_t pkcs8_b_bytes;
 const uint8_t *pk_a;size_t pk_a_bytes;
 const uint8_t *pk_b;size_t pk_b_bytes;
} YNXIDEDeploymentV2NativeKeySpans;
/* Output partial is retained even on error. No default/admitted row supplied. */
int ynx_source_ide_deployment_v2_key_loan_acquire(const YNXIDEDeploymentV2LoanContext*,YNXIDEDeploymentV2KeyLoan**);
/* Source owner must keep loan alive and serialized for the entire Core call.
 * A successful borrow pins the two expected full public keys. Core's existing
 * ImportKeyMaterial must rederive+check both keys using exact54/150 DER. */
int ynx_source_ide_deployment_v2_key_loan_borrow(YNXIDEDeploymentV2KeyLoan*,const YNXIDEDeploymentV2LoanContext*,YNXIDEDeploymentV2NativeKeySpans*);
int ynx_source_ide_deployment_v2_key_loan_current(YNXIDEDeploymentV2KeyLoan*,const YNXIDEDeploymentV2LoanContext*);
void ynx_source_ide_deployment_v2_key_loan_retire(YNXIDEDeploymentV2KeyLoan*);
int ynx_source_ide_deployment_v2_key_loan_join(YNXIDEDeploymentV2KeyLoan*);
int ynx_source_ide_deployment_v2_key_loan_close(YNXIDEDeploymentV2KeyLoan*);
#ifdef __cplusplus
}
#endif
