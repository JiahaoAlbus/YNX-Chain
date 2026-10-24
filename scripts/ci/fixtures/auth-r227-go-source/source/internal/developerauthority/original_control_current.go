package developerauthority

// Complete NORMAL current-dispatch callee. This is deliberately distinct from
// the signature-only DATA entry: it retains both original current observations
// and rejects a changed Root-selected capture after the subprocess completes.
import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"time"
)

type originalControlCurrent struct {
	approval                            Approval
	projection                          originalControlProjection
	before, after, original             []byte
	sourceID, instanceID, profile, head string
	sequence, floor, generation         uint64
}

func (*originalControlCurrent) String() string {
	return "OriginalControlCurrent{original capture retained privately}"
}

type originalControlSourceProjection struct {
	Selection  json.RawMessage `json:"selection"`
	Principal  string          `json:"principalId"`
	Owner      string          `json:"subjectOwner"`
	KeyVersion string          `json:"subjectKeyVersion"`
	Generation uint64          `json:"generation"`
	Sequence   uint64          `json:"sequence"`
	Floor      uint64          `json:"floor"`
	Head       string          `json:"head"`
	Status     string          `json:"status"`
	TimeFloor  int64           `json:"timeFloor"`
	Expires    int64           `json:"expiresAtMs"`
	Profile    string          `json:"profileDigest"`
	SourceID   string          `json:"sourceId"`
	InstanceID string          `json:"instanceId"`
	Height     string          `json:"executionHeight"`
	Data       bool            `json:"dataOnly"`
	Admission  bool            `json:"nativeAdmission"`
}

func controlSourceProjection(raw []byte, before time.Time) (originalControlSourceProjection, error) {
	var p originalControlSourceProjection
	// Reuse the actual original boundary, including duplicate-field rejection,
	// timestamp/canonical-U64 checks and the DATA-only flags. No new verifier.
	// A nested JSON object has no transport newline; the existing checker
	// validates standalone CLI framing. Add only that framing, never data fields.
	framed := append(append([]byte(nil), raw...), '\n')
	if checkOriginalCurrentProcessOutput(framed, before) != "" {
		return p, ErrDenied
	}
	var envelope struct {
		Projection json.RawMessage `json:"projection"`
	}
	if json.Unmarshal(raw, &envelope) != nil || json.Unmarshal(envelope.Projection, &p) != nil {
		return p, ErrDenied
	}
	return p, nil
}

func originalControlCaptureMatches(p originalControlSourceProjection, principal Principal, cmd Command, caller string, now int64) bool {
	var selection struct {
		Capture json.RawMessage `json:"projectControlCapture"`
		Peer    struct {
			WalletCode string `json:"walletCodeIdentity"`
		} `json:"identityPeerBinding"`
	}
	if json.Unmarshal(p.Selection, &selection) != nil || selection.Peer.WalletCode != caller {
		return false
	}
	var version, request, pr, command, expires string
	var review json.RawMessage
	if decodeExactObject(selection.Capture, 131072, map[string]any{"version": &version, "review": &review, "requestOriginal": &request, "principalOriginal": &pr, "commandOriginal": &command, "expiresAtMs": &expires}) != nil || version != "YNX-IDE-PROJECT-CONTROL-CAPTURE/v1" {
		return false
	}
	decode := func(s string) []byte {
		b, e := base64.RawURLEncoding.Strict().DecodeString(s)
		if e != nil || base64.RawURLEncoding.EncodeToString(b) != s {
			return nil
		}
		return b
	}
	praw, _ := json.Marshal(principal)
	craw, _ := json.Marshal(cmd)
	e, err := strconv.ParseInt(expires, 10, 64)
	return err == nil && strconv.FormatInt(e, 10) == expires && e > now && e-now <= 30000 && bytes.Equal(decode(pr), praw) && bytes.Equal(decode(command), craw) && len(decode(request)) > 0
}

func (o *OriginalSourceVerifierOwner) invokeOriginalControlCurrent(ctx context.Context, input []byte, p Principal, cmd Command, proof []byte, nonce, caller string) (*originalControlCurrent, error) {
	now := time.Now().UnixMilli()
	if !principalValid(p, now) || !cmd.valid(now) || len(proof) == 0 || len(proof) > originalProjectControlApprovalLimit || !readNonceToken.MatchString(nonce) || !text(caller) {
		return nil, ErrDenied
	}
	var operation, original string
	var source, principal, command json.RawMessage
	var expected struct {
		Nonce  string `json:"nonce"`
		Caller string `json:"callerIdentity"`
		Ref    string `json:"sourceCurrentRef"`
	}
	var expectedRaw json.RawMessage
	if decodeExactObject(input, originalVerifierInputLimit, map[string]any{"operation": &operation, "source": &source, "approvalOriginal": &original, "principal": &principal, "command": &command, "expected": &expectedRaw}) != nil || operation != "ide-project-control-current-native-node/v1" || original != string(proof) || decodeExactObject(expectedRaw, 4096, map[string]any{"nonce": &expected.Nonce, "callerIdentity": &expected.Caller, "sourceCurrentRef": &expected.Ref}) != nil || expected.Nonce != nonce || expected.Caller != caller || expected.Ref != p.CurrentRef {
		return nil, ErrDenied
	}
	// The SDK independently re-encodes the supplied display DTOs against the
	// original signed capture. The server rebinds original numeric Go bytes below.
	var frozenProfile string
	var sourceFields map[string]json.RawMessage
	if json.Unmarshal(source, &sourceFields) != nil || json.Unmarshal(sourceFields["profileRaw"], &frozenProfile) != nil || frozenProfile == "" {
		return nil, ErrDenied
	}
	var selected *originalControlCurrent
	raw, e := o.invokeDATA(ctx, input, originalVerifierOutputLimit, false, func(raw []byte, before time.Time) string {
		var version, failure, approval string
		var completed, data, authorized, admission bool
		var first, last, projection json.RawMessage
		if !bytes.HasSuffix(raw, []byte("\n")) || decodeExactObject(bytes.TrimSuffix(raw, []byte("\n")), originalVerifierOutputLimit, map[string]any{"version": &version, "completed": &completed, "sourceBefore": &first, "sourceAfter": &last, "approvalOriginal": &approval, "projection": &projection, "failureCode": &failure, "dataOnly": &data, "authorized": &authorized, "nativeAdmission": &admission}) != nil || version != "YNX-IDE-CONTROL-VERIFICATION-DATA/v1" || !completed || !data || authorized || admission || failure != "" || approval != string(proof) {
			return "CONTROL_CURRENT_OUTPUT"
		}
		a, err := controlSourceProjection(first, before)
		if err != nil {
			return "CONTROL_CURRENT_BEFORE"
		}
		b, err := controlSourceProjection(last, before)
		if err != nil {
			return "CONTROL_CURRENT_AFTER"
		}
		if a.Profile != hash([]byte(frozenProfile)) || a.Profile != b.Profile || a.SourceID != b.SourceID || a.InstanceID != b.InstanceID || a.Generation != b.Generation || a.Sequence != b.Sequence || a.Floor != b.Floor || a.Head != b.Head || a.Owner != b.Owner || a.KeyVersion != b.KeyVersion || a.Principal != b.Principal || !bytes.Equal(a.Selection, b.Selection) {
			return "CONTROL_CURRENT_CHANGED"
		}
		ah, ae := strconv.ParseUint(a.Height, 10, 64)
		bh, be := strconv.ParseUint(b.Height, 10, 64)
		if ae != nil || be != nil || bh < ah || b.TimeFloor < a.TimeFloor {
			return "CONTROL_CURRENT_ROLLBACK"
		}
		var r originalControlProjection
		// Reuse the strict signature projection checker in a local helper, not a
		// second subprocess or second network request/nonce/signing attempt.
		if decodeControlProjection(projection, &r) != nil || r.PrincipalSHA256 != objectHash(p) || r.BindingSHA256 != objectHash(cmd) || r.ProofSHA256 != hash(proof) || r.RequestID != cmd.RequestID || r.Nonce != nonce || !text(r.ConfirmationRef) || !text(r.RevocationRef) || !r.SignatureVerified || !r.DataOnly || r.Authorized || r.Committed || r.NativeAdmission || r.Ready != (r.Decision == "approve") || (r.Decision != "approve" && r.Decision != "reject") {
			return "CONTROL_CURRENT_BINDING"
		}
		at := time.Now().UnixMilli()
		if at < before.UnixMilli() || r.ExpiresMS <= at || r.ExpiresMS > p.ExpiresMS || r.ExpiresMS > cmd.ExpiresMS || r.ExpiresMS-before.UnixMilli() > 30000 || at >= a.Expires || at >= b.Expires || !originalControlCaptureMatches(a, p, cmd, caller, at) || !originalControlCaptureMatches(b, p, cmd, caller, at) {
			return "CONTROL_CURRENT_EXPIRED_OR_CAPTURE"
		}
		selected = &originalControlCurrent{approval: Approval{objectHash(p), objectHash(cmd), hash(proof), r.ConfirmationRef, r.RevocationRef, r.ExpiresMS}, projection: r, before: append([]byte(nil), first...), after: append([]byte(nil), last...), sourceID: a.SourceID, instanceID: a.InstanceID, profile: a.Profile, head: a.Head, sequence: a.Sequence, floor: a.Floor, generation: a.Generation}
		return ""
	})
	if selected != nil {
		selected.original = append([]byte(nil), raw...)
	}
	return selected, e
}

func decodeControlProjection(raw []byte, r *originalControlProjection) error {
	return decodeExactObject(raw, 16384, map[string]any{"principalSHA256": &r.PrincipalSHA256, "bindingSHA256": &r.BindingSHA256, "proofSHA256": &r.ProofSHA256, "confirmationRef": &r.ConfirmationRef, "revocationRef": &r.RevocationRef, "requestId": &r.RequestID, "nonce": &r.Nonce, "decision": &r.Decision, "expiresMS": &r.ExpiresMS, "readyForSourceVerification": &r.Ready, "signatureVerified": &r.SignatureVerified, "dataOnly": &r.DataOnly, "authorized": &r.Authorized, "committed": &r.Committed, "nativeAdmission": &r.NativeAdmission})
}
