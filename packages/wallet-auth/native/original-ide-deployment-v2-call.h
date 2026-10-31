#pragma once
#include "original-ide-deployment-v2-key-loan.h"
#include "core-abi/deployment_manifest_v2.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct YNXSourceDeploymentV2Call YNXSourceDeploymentV2Call;
/* Public captures only; private spans come exclusively from the held Source
 * loan. Source selects expected E11/Bind/public pair independently, never echo
 * of the caller. Source context must already match the immutable Root row. */
typedef struct {
 YNXArtifactBytesV1 payload_original,actual_artifact,expected_payload_original;
 YNXArtifactBytesV1 expected_payload_bind,expected_artifact_bind,profile_network_id,subject_owner,expected_pk_a,expected_pk_b;
} YNXSourceDeploymentV2PublicOriginals;
int ynx_source_deployment_v2_call_capture(YNXIDEDeploymentV2KeyLoan*,const YNXIDEDeploymentV2LoanContext*,const YNXSourceDeploymentV2PublicOriginals*,YNXSourceDeploymentV2Call**);
/* Fixed typed Core callee YNXDeploymentManifestSignV2 ONLY, selected once. */
int ynx_source_deployment_v2_call_invoke(YNXSourceDeploymentV2Call*);
/* Public output is available even after a late Source current failure. No key
 * bytes are returned. Do not interpret this as final Source permission. */
int ynx_source_deployment_v2_call_copy_partial(YNXSourceDeploymentV2Call*,uint8_t*,size_t,size_t*,int32_t*,uint32_t*);
int ynx_source_deployment_v2_call_current(YNXSourceDeploymentV2Call*);
void ynx_source_deployment_v2_call_retire(YNXSourceDeploymentV2Call*);
int ynx_source_deployment_v2_call_join(YNXSourceDeploymentV2Call*);
int ynx_source_deployment_v2_call_close(YNXSourceDeploymentV2Call*);
#ifdef __cplusplus
}
#endif
