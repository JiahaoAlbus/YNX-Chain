package developerauthority

// Fixed normal-process CONTROL verification. The result remains DATA: only
// the complete Source may promote it after durable registry/current/revoke
// checks and once consumption. This owner cannot implement OriginalSource.
import (
	"bytes"
	"context"
	"time"
)

type originalControlProjection struct {
	PrincipalSHA256   string `json:"principalSHA256"`
	BindingSHA256     string `json:"bindingSHA256"`
	ProofSHA256       string `json:"proofSHA256"`
	ConfirmationRef   string `json:"confirmationRef"`
	RevocationRef     string `json:"revocationRef"`
	RequestID         string `json:"requestId"`
	Nonce             string `json:"nonce"`
	Decision          string `json:"decision"`
	ExpiresMS         int64  `json:"expiresMS"`
	Ready             bool   `json:"readyForSourceVerification"`
	SignatureVerified bool   `json:"signatureVerified"`
	DataOnly          bool   `json:"dataOnly"`
	Authorized        bool   `json:"authorized"`
	Committed         bool   `json:"committed"`
	NativeAdmission   bool   `json:"nativeAdmission"`
}

// input must already belong to the factory's original captured operation.
// Do not expose this as a route accepting arbitrary registry/current values.
func (o *OriginalSourceVerifierOwner) invokeOriginalControlDATA(ctx context.Context, input []byte, p Principal, cmd Command, proof []byte, nonce string) ([]byte, error) {
	if len(input) == 0 || len(input) > originalVerifierInputLimit || !principalValid(p, time.Now().UnixMilli()) || !cmd.valid(time.Now().UnixMilli()) || len(proof) == 0 || len(proof) > originalProjectControlApprovalLimit || !readNonceToken.MatchString(nonce) {
		return nil, ErrDenied
	}
	return o.invokeDATA(ctx, input, 16384, false, func(raw []byte, before time.Time) string {
		if len(raw) > 16384 || !bytes.HasSuffix(raw, []byte("\n")) {
			return "CONTROL_OUTPUT"
		}
		var r originalControlProjection
		if decodeExactObject(bytes.TrimSuffix(raw, []byte("\n")), 16384, map[string]any{
			"principalSHA256": &r.PrincipalSHA256, "bindingSHA256": &r.BindingSHA256, "proofSHA256": &r.ProofSHA256, "confirmationRef": &r.ConfirmationRef, "revocationRef": &r.RevocationRef, "requestId": &r.RequestID, "nonce": &r.Nonce, "decision": &r.Decision, "expiresMS": &r.ExpiresMS, "readyForSourceVerification": &r.Ready, "signatureVerified": &r.SignatureVerified, "dataOnly": &r.DataOnly, "authorized": &r.Authorized, "committed": &r.Committed, "nativeAdmission": &r.NativeAdmission,
		}) != nil {
			return "CONTROL_OUTPUT"
		}
		if r.PrincipalSHA256 != objectHash(p) || r.BindingSHA256 != objectHash(cmd) || r.ProofSHA256 != hash(proof) || r.Nonce != nonce || r.RequestID != cmd.RequestID || !text(r.ConfirmationRef) || !text(r.RevocationRef) || !r.SignatureVerified || !r.DataOnly || r.Authorized || r.Committed || r.NativeAdmission || r.Ready != (r.Decision == "approve") || (r.Decision != "approve" && r.Decision != "reject") {
			return "CONTROL_BINDING"
		}
		now := time.Now().UnixMilli()
		if now < before.UnixMilli() || r.ExpiresMS <= now || r.ExpiresMS > p.ExpiresMS || r.ExpiresMS > cmd.ExpiresMS || r.ExpiresMS-before.UnixMilli() > 30000 {
			return "CONTROL_EXPIRED"
		}
		return ""
	})
}
