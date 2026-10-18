/* Included only by the original TPM owner TU, after the actual independently
 * verified increment-observation implementation. No public resource loader,
 * callback, software floor, counter mutation or grant constructor lives here.
 *
 * These pointers are borrowed from the SAME qualified server joint owner.
 * Pointer/name recognition alone is not qualification. OK means only that
 * both actually retained TPM increments are still observed under their fixed
 * original budgets. The enclosing server must separately retain its admitted
 * purpose, same original terminal and independent joint fence. */
int ynx_tpm2_pair_retired_observed_current(
 ynx_tpm2_owner *issuer,ynx_tpm2_owner *anchor,
 const unsigned char issuer_challenge[32],
 const unsigned char anchor_challenge[32]){
 /* Recognition and original thread BEFORE any dereference. Do not call the
  * old current(): it deliberately refuses entered uncertainty. This method
  * verifies the successful original increment without resetting that latch. */
 if(!same_thread(issuer)||!same_thread(anchor)||issuer==anchor||
  !issuer_challenge||!anchor_challenge)return YNX_TPM2_REFUSED;
 if(!issuer->ready||!anchor->ready||!issuer->entered||!anchor->entered||
  !issuer->attempted||!anchor->attempted||issuer->cancelled||anchor->cancelled||
  issuer->borrowed||anchor->borrowed)return YNX_TPM2_REFUSED;
 if(issuer->first||anchor->first)return YNX_TPM2_UNKNOWN;
 /* Two C wrappers over one physical counter/AK are not independent parties.
  * This non-alias test is necessary, never sufficient to admit a custodian. */
 if(name_equal(&issuer->selected.counter_name,&anchor->selected.counter_name)||
  name_equal(&issuer->selected.ak_name,&anchor->selected.ak_name))
  return YNX_TPM2_REFUSED;
 if(!budget_current(issuer))return fail(issuer,0,1);
 if(!budget_current(anchor))return fail(anchor,0,1);
 TPM2B_ATTEST *issuer_att=NULL,*anchor_att=NULL;
 TPMT_SIGNATURE *issuer_sig=NULL,*anchor_sig=NULL;
 int result=ynx_tpm2_owner_increment_observed_current(
  issuer,issuer_challenge,&issuer_att,&issuer_sig);
 if(result!=YNX_TPM2_OK)goto cleanup;
 if(!budget_current(issuer)){result=fail(issuer,0,1);goto cleanup;}
 if(!budget_current(anchor)){result=fail(anchor,0,1);goto cleanup;}
 result=ynx_tpm2_owner_increment_observed_current(
  anchor,anchor_challenge,&anchor_att,&anchor_sig);
 if(result!=YNX_TPM2_OK)goto cleanup;
 /* Re-read the first actual counter after observing the independent anchor.
  * The same original signed certificate is reverified; the physical NV value
  * is freshly read by the original primitive, not cached from a public proof. */
 if(!budget_current(issuer)){result=fail(issuer,0,1);goto cleanup;}
 if(!budget_current(anchor)){result=fail(anchor,0,1);goto cleanup;}
 result=ynx_tpm2_owner_increment_observed_current(
  issuer,issuer_challenge,&issuer_att,&issuer_sig);
 if(result!=YNX_TPM2_OK)goto cleanup;
 if(!budget_current(issuer)){result=fail(issuer,0,1);goto cleanup;}
 if(!budget_current(anchor)){result=fail(anchor,0,1);goto cleanup;}
cleanup:
 /* ESAPI may return partial allocations even on non-OK. They are not caller
  * originals or keys, and must never leak or be retried after refusal. */
 Esys_Free(issuer_att);Esys_Free(issuer_sig);
 Esys_Free(anchor_att);Esys_Free(anchor_sig);
 return result;
}
