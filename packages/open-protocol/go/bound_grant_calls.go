package openprotocol

// OriginalProtectedGrantProof is an opaque original proof carrier. An Auth
// adapter must verify it; this interface does not manufacture proof authority.
type OriginalProtectedGrantProof any
type BoundGrantIssuerApprovalV1 struct {
	ID                                             string
	Principal                                      LegacyGrantRefV1
	PrincipalKind, Purpose, GrantID, GrantRevision string
	Binding                                        GrantBindV1
	Expires, Nonce                                 string
}
type OriginalBoundGrantIssueResult struct {
	Original                                any
	RecoveryOnly, NewGrant, SourceAdmission bool
}
type OriginalGrantEffectReceipt struct {
	State, Scope, EffectRef string
	Original                any
}

// OriginalBoundGrantAuthorityCalls mirrors the existing protected-kernel call
// names. No client factory, HTTP route or admitted Source is installed here.
type OriginalBoundGrantAuthorityCalls interface {
	SignBoundGrant(BoundGrantV1, BoundGrantIssuerApprovalV1, OriginalProtectedGrantProof) (OriginalBoundGrantIssueResult, error)
	AuthorizeAtEffect(BoundGrantV1, GrantStepBindingV1, OriginalProtectedGrantProof, string) (OriginalGrantEffectReceipt, error)
}

// A requirement for an authorized original-operation lookup, not an existing
// service method. The resource authority derives the original semantic slot;
// UNKNOWN never releases budget or obtains a fresh dispatch by changed body ID.
type BoundGrantAuthorizedReconciliationRequirement struct {
	Realm, Tenant, GrantID, GrantRevision string
	Task                                  LegacyGrantRefV1
	Generation, StepID                    string
	Tool                                  GrantToolV1
	Operation                             string
}
