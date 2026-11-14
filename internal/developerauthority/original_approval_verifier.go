package developerauthority

// Normal read-only SOURCE-side counterpart of the protected issuer. This uses
// the SAME original pinned CLI/Node24 data process, never the Node26 signer or
// addon. It returns originals/DATA, NOT VerifiedPublication or a Principal.
import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Exact JS JSON.stringify STRING transport escaping. Signed/opaque originals
// are not rebuilt; only the outer fixed process envelope uses this routine.
// In particular do not HTML-escape or rewrite a literal backslash-u sequence.
func originalApprovalTransportString(s string) (string, bool) {
	if !utf8.ValidString(s) {
		return "", false
	}
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"', '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 32 {
				const h = "0123456789abcdef"
				b.WriteString(`\u00`)
				b.WriteByte(h[byte(r)>>4])
				b.WriteByte(h[byte(r)&15])
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String(), true
}
func (o *OriginalSourceVerifierOwner) InvokeOriginalApprovalCurrentDATA(ctx context.Context, input []byte) ([]byte, error) {
	if len(input) == 0 || len(input) > originalVerifierInputLimit {
		return nil, ErrDenied
	}
	var operation, scope, nonce string
	var source, previous json.RawMessage
	if decodeExactObject(input, originalVerifierInputLimit, map[string]any{"operation": &operation, "source": &source, "expectedScopeOriginal": &scope, "nonce": &nonce, "previous": &previous}) != nil || operation != "ide-publication-approval-current-native-node/v1" || len(scope) == 0 || len(scope) > 16384 {
		return nil, ErrDenied
	}
	n, e := base64.RawURLEncoding.DecodeString(nonce)
	if e != nil || len(n) != 32 || base64.RawURLEncoding.EncodeToString(n) != nonce || bytes.Equal(n, make([]byte, 32)) {
		return nil, ErrDenied
	}
	expected := hash([]byte(scope))
	return o.invokeDATA(ctx, input, originalVerifierOutputLimit, false, func(raw []byte, before time.Time) string {
		return checkOriginalApprovalProcessOutput(raw, before, expected, nonce)
	})
}
func checkOriginalApprovalProcessOutput(raw []byte, before time.Time, expectedScopeSHA, expectedNonce string) string {
	if !bytes.HasSuffix(raw, []byte("\n")) {
		return "APPROVAL_OUTPUT"
	}
	var version, failure, approval string
	var completed, data, authorized, admission bool
	var first, last, projection json.RawMessage
	if decodeExactObject(bytes.TrimSuffix(raw, []byte("\n")), originalVerifierOutputLimit, map[string]any{"version": &version, "completed": &completed, "sourceBefore": &first, "sourceAfter": &last, "approvalOriginal": &approval, "projection": &projection, "failureCode": &failure, "dataOnly": &data, "authorized": &authorized, "nativeAdmission": &admission}) != nil || version != "YNX-IDE-APPROVAL-VERIFICATION-DATA/v1" || !completed || failure != "" || !data || authorized || admission || len(approval) == 0 || len(approval) > 393216 {
		return "APPROVAL_OUTPUT"
	}
	if checkOriginalCurrentProcessOutput(append(append([]byte(nil), first...), '\n'), before) != "" || checkOriginalCurrentProcessOutput(append(append([]byte(nil), last...), '\n'), before) != "" {
		return "APPROVAL_POST_SOURCE"
	}
	var kind, scopeSHA, statementSHA, resultSHA, sequence, floor, decision, state, signedHeight, observedHeight string
	var timeFloor, expires int64
	var ready, verified, pub, resource bool
	if decodeExactObject(projection, originalVerifierOutputLimit, map[string]any{"kind": &kind, "scopeSHA256": &scopeSHA, "statementSHA256": &statementSHA, "resultOriginalSHA256": &resultSHA, "sequence": &sequence, "floor": &floor, "decision": &decision, "requestState": &state, "statementExecutionHeight": &signedHeight, "observedExecutionHeight": &observedHeight, "timeFloor": &timeFloor, "expiresAtMs": &expires, "readyForSourceVerification": &ready, "dataOnly": &data, "signatureVerified": &verified, "authorized": &authorized, "nativeAdmission": &admission, "publicationAuthorized": &pub, "resourceAuthorized": &resource}) != nil || scopeSHA != expectedScopeSHA || !approvalHex.MatchString(statementSHA) || !verified || !data || authorized || admission || pub || resource || (kind != "artifact" && kind != "resource") {
		return "APPROVAL_PROJECTION"
	}
	var wireVersion, scopeOriginal, currentOriginal, memberOriginal string
	var wireBinding json.RawMessage
	if decodeExactObject([]byte(approval), 393216, map[string]any{"version": &wireVersion, "binding": &wireBinding, "scopeOriginal": &scopeOriginal, "currentOriginal": &currentOriginal, "memberOriginal": &memberOriginal}) != nil || wireVersion != "YNX-IDE-APPROVAL-CURRENT/v1" || hash([]byte(scopeOriginal)) != expectedScopeSHA || hash([]byte(currentOriginal)) != statementSHA || memberOriginal == "" {
		return "APPROVAL_ORIGINAL_BINDING"
	}
	var bodyNonce string
	var body map[string]json.RawMessage
	if json.Unmarshal([]byte(currentOriginal), &body) != nil || json.Unmarshal(body["nonce"], &bodyNonce) != nil || bodyNonce != expectedNonce {
		return "APPROVAL_NONCE_BINDING"
	}
	parse := func(s string, positive bool) (uint64, bool) {
		v, e := strconv.ParseUint(s, 10, 64)
		return v, e == nil && strconv.FormatUint(v, 10) == s && (!positive || v > 0)
	}
	seq, ok := parse(sequence, true)
	fl, fok := parse(floor, false)
	sh, sok := parse(signedHeight, false)
	oh, ook := parse(observedHeight, false)
	if !ok || !fok || fl > seq || !sok || !ook || sh > oh || timeFloor < before.UnixMilli() || time.Now().UnixMilli() < timeFloor || time.Now().UnixMilli() >= expires {
		return "APPROVAL_POST_CURRENT"
	}
	if ready && (decision != "approved" || (state != "signed-unhanded" && state != "returned") || !approvalHex.MatchString(resultSHA)) {
		return "APPROVAL_READY_BINDING"
	}
	if decision != "approved" && decision != "rejected" && decision != "revoked" && decision != "expired" && decision != "unknown" {
		return "APPROVAL_DECISION"
	}
	if state != "selected" && state != "signed-unhanded" && state != "returned" && state != "rejected" && state != "failed" && state != "unknown" {
		return "APPROVAL_STATE"
	}
	// Source must independently authenticate the normal request/Principal,
	// publisher/caller/result originals, scope and durable previous. This does
	// not cast even a valid response into a publication/resource permit.
	return ""
}
