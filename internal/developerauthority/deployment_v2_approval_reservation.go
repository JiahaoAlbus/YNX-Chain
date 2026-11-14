package developerauthority

import "context"

// Actual original durable store, selected BEFORE the fixed native role issuer.
// signed-unhanded refers to the already independently E11-verified original
// Member retained here. It is NOT an execution grant; only the later separate
// current-role signature+review+full Source/ACL AND can produce a ready handoff.
func prepareOriginalDeploymentV2ApprovalQuery(ctx context.Context, store *originalApprovalStore, scope originalApprovalScopeDATA, captureDigest string, member []byte, nonce string) (*originalApprovalQueryDATA, error) {
	row, e := store.prepare(ctx, scope)
	if e != nil {
		return nil, e
	}
	row, e = store.transition(ctx, scope.ref, captureDigest, row.stateSHA256, "approved", "signed-unhanded", 0, member)
	if e != nil || row == nil || row.sequence != 2 {
		return nil, ErrUnknown
	}
	q, e := store.reserveQuery(ctx, scope.ref, nonce)
	if e != nil {
		return q, e
	}
	if e = store.selectQuerySigning(ctx, q); e != nil {
		return q, e
	}
	return q, nil
}
