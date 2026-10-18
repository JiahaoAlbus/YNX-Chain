/* Link the actual production entry graph; no owner, key or TPM call occurs. */
#include "ynx_tpm2_esys_owner.h"
static int (*volatile linked_storage_open)(ynx_tpm2_owner *,const unsigned char [32],
 const struct ynx_storage_expected *,const unsigned char *,size_t,
 unsigned char *,size_t,size_t *)=ynx_tpm2_owner_storage_open_v1;
int main(void){return linked_storage_open==0;}
