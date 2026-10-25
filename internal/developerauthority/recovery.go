package developerauthority

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
)

// Recovery never creates a replacement account or copies old-device roles.
// All effects stay in the original account/device registry. These private
// bindings are NOT an independent login protocol or a Root/SSO grant.
type RecoveryRequest struct {
	RequestID, Account, DeviceID, DevicePublicSHA256 string
	ExpiresMS                                        int64
}
type RecoveryResult struct {
	RequestID, Account, DeviceID, DevicePublicSHA256, RegistrationRef, State string
	PublicOriginal                                                           []byte
}
type OriginalRecoverySource interface {
	AuthorizeExistingAccountRecovery(context.Context, Principal, RecoveryRequest, []byte) (Approval, error)
	AssertRecoveryCurrent(context.Context, Principal, RecoveryRequest, Approval) error
	EnrollOriginalDeviceForExistingAccount(context.Context, Principal, RecoveryRequest, Approval) (*RecoveryResult, error)
	ObserveOriginalDeviceEnrollment(context.Context, Principal, RecoveryRequest) (*RecoveryResult, error)
}

func recoveryValid(r RecoveryRequest, p Principal, now int64) bool {
	b, e := hex.DecodeString(r.DevicePublicSHA256)
	return e == nil && len(b) == 32 && hex.EncodeToString(b) == r.DevicePublicSHA256 && text(r.RequestID) && r.Account == p.Account && r.DeviceID == p.DeviceID && principalValid(p, now) && r.ExpiresMS > now && r.ExpiresMS-now <= 300000
}
func recoveryApprovalValid(a Approval, p Principal, r RecoveryRequest, proof []byte, now int64) bool {
	return a.PrincipalSHA256 == objectHash(p) && a.BindingSHA256 == objectHash(r) && a.ProofSHA256 == hash(proof) && text(a.ConfirmationRef) && text(a.RevocationRef) && a.ExpiresMS > now && a.ExpiresMS <= r.ExpiresMS && a.ExpiresMS <= p.ExpiresMS
}
func recoveryResultMatches(result *RecoveryResult, r RecoveryRequest) bool {
	return result != nil && result.RequestID == r.RequestID && result.Account == r.Account && result.DeviceID == r.DeviceID && result.DevicePublicSHA256 == r.DevicePublicSHA256 && text(result.RegistrationRef) && len(result.PublicOriginal) > 0 && len(result.PublicOriginal) <= 65536 && result.State == "registered-existing-account"
}

// A successful reservation is persisted UNKNOWN BEFORE the sole native call.
// Repeated or ambiguous reservations never dispatch again. Both error+partial
// and post-current failures retain actual public result in the original row.
func (c *Catalog) RecoverExistingIdentity(ctx context.Context, httpRequest *http.Request, request RecoveryRequest, proof []byte) (*RecoveryResult, error) {
	if ctx == nil || httpRequest == nil || len(proof) == 0 || len(proof) > 65536 {
		return nil, ErrDenied
	}
	source, ok := c.source.(OriginalRecoverySource)
	if !ok {
		return nil, ErrDenied
	}
	p, e := c.Principal(ctx, httpRequest)
	if e != nil || !recoveryValid(request, p, c.now().UnixMilli()) {
		return nil, ErrDenied
	}
	proof = append([]byte(nil), proof...)
	a, e := source.AuthorizeExistingAccountRecovery(ctx, p, request, proof)
	if e != nil || !recoveryApprovalValid(a, p, request, proof, c.now().UnixMilli()) {
		return nil, ErrDenied
	}
	raw, _ := json.Marshal(request)
	reserved, e := c.db.ExecContext(ctx, "INSERT INTO developer_identity_recoveries(account,request_id,binding_sha256,request_original,proof_sha256,confirmation_ref,revocation_ref,state) VALUES($1,$2,$3,$4,$5,$6,$7,'unknown') ON CONFLICT DO NOTHING", p.Account, request.RequestID, objectHash(request), raw, a.ProofSHA256, a.ConfirmationRef, a.RevocationRef)
	if e != nil {
		return nil, errors.Join(ErrUnknown, e)
	}
	n, e := reserved.RowsAffected()
	if e != nil || n != 1 {
		return nil, ErrUnknown
	}
	if e = source.AssertRecoveryCurrent(ctx, p, request, a); e != nil || !recoveryApprovalValid(a, p, request, proof, c.now().UnixMilli()) {
		return nil, ErrUnknown
	}
	actual, callErr := source.EnrollOriginalDeviceForExistingAccount(ctx, p, request, a)
	return c.retainRecovery(ctx, p, request, actual, callErr, func() error {
		if !recoveryApprovalValid(a, p, request, proof, c.now().UnixMilli()) {
			return ErrDenied
		}
		if e := source.AssertRecoveryCurrent(ctx, p, request, a); e != nil {
			return e
		}
		if !recoveryApprovalValid(a, p, request, proof, c.now().UnixMilli()) {
			return ErrDenied
		}
		return nil
	})
}
func (c *Catalog) retainRecovery(ctx context.Context, p Principal, r RecoveryRequest, actual *RecoveryResult, callErr error, current func() error) (*RecoveryResult, error) {
	// Capture before checking status. Never expose foreign/malformed actual data
	// as a new identity; it remains server-side non-authoritative audit custody.
	var captured *RecoveryResult
	if actual != nil {
		copy := *actual
		copy.PublicOriginal = append([]byte(nil), actual.PublicOriginal...)
		captured = &copy
	}
	valid := recoveryResultMatches(captured, r)
	currentErr := current()
	state := "unknown"
	if callErr == nil && currentErr == nil && valid {
		state = "recovered"
	}
	raw, e := json.Marshal(captured)
	if e != nil || len(raw) > 98304 {
		return captured, ErrUnknown
	}
	result, e := c.db.ExecContext(ctx, "UPDATE developer_identity_recoveries SET result_original=$1,result_sha256=$2,state=$3 WHERE account=$4 AND request_id=$5 AND binding_sha256=$6 AND state='unknown'", raw, hash(raw), state, p.Account, r.RequestID, objectHash(r))
	if e != nil {
		return captured, errors.Join(ErrUnknown, e)
	}
	n, e := result.RowsAffected()
	if e != nil || n != 1 {
		return captured, ErrUnknown
	}
	if state != "recovered" {
		return captured, ErrUnknown
	}
	if e = current(); e != nil {
		return captured, ErrUnknown
	}
	return captured, nil
}

// Observe only: an authenticated same account can reconcile its exact original
// row. Missing/unproven never means not-sent, and never calls Enroll or retry.
func (c *Catalog) ObserveExistingIdentityRecovery(ctx context.Context, httpRequest *http.Request, requestID string) (*RecoveryResult, error) {
	if ctx == nil || httpRequest == nil || !text(requestID) {
		return nil, ErrDenied
	}
	source, ok := c.source.(OriginalRecoverySource)
	if !ok {
		return nil, ErrDenied
	}
	p, e := c.Principal(ctx, httpRequest)
	if e != nil {
		return nil, e
	}
	var raw []byte
	var binding, state string
	e = c.db.QueryRowContext(ctx, "SELECT request_original,binding_sha256,state FROM developer_identity_recoveries WHERE account=$1 AND request_id=$2", p.Account, requestID).Scan(&raw, &binding, &state)
	if e != nil {
		return nil, ErrUnknown
	}
	var r RecoveryRequest
	if json.Unmarshal(raw, &r) != nil || objectHash(r) != binding || r.Account != p.Account || r.RequestID != requestID {
		return nil, ErrConflict
	}
	// Original target may not be changed to this observer's other device.
	actual, observeErr := source.ObserveOriginalDeviceEnrollment(ctx, p, r)
	if state == "recovered" {
		if observeErr != nil || !recoveryResultMatches(actual, r) {
			return actual, ErrUnknown
		}
		if e = c.source.AssertPrincipalCurrent(ctx, p); e != nil || !principalValid(p, c.now().UnixMilli()) {
			return actual, ErrDenied
		}
		return actual, nil
	}
	return c.retainRecovery(ctx, p, r, actual, observeErr, func() error {
		if e := c.source.AssertPrincipalCurrent(ctx, p); e != nil {
			return e
		}
		if !principalValid(p, c.now().UnixMilli()) {
			return ErrDenied
		}
		return nil
	})
}

// Fresh resource permissions are queried from CURRENT catalog membership,
// never copied from old device or recovery receipt. Every later effect still
// calls CurrentProject/RecheckProject again; these are DATA, not tokens.
func (c *Catalog) CurrentRecoveredProjectAccess(ctx context.Context, httpRequest *http.Request, projectIDs []string) ([]Access, error) {
	if len(projectIDs) > 256 {
		return nil, ErrDenied
	}
	out := make([]Access, 0, len(projectIDs))
	seen := map[string]bool{}
	p, e := c.Principal(ctx, httpRequest)
	if e != nil {
		return nil, e
	}
	for _, id := range projectIDs {
		if seen[id] || !text(id) {
			return nil, ErrDenied
		}
		seen[id] = true
		a, e := c.CurrentProject(ctx, httpRequest, id)
		if e != nil || a.Principal != p {
			return nil, ErrDenied
		}
		out = append(out, a)
	}
	if e = c.source.AssertPrincipalCurrent(ctx, p); e != nil {
		return nil, ErrDenied
	}
	return out, nil
}
