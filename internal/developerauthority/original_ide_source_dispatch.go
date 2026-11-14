package developerauthority

import (
	"bytes"
	"encoding/json"
	"time"
)

// All check functions are fixed package CODE; no caller-supplied verifier or
// granting callbacks. Both original Source result envelopes remain DATA.
func originalIDEDispatchOutput(raw []byte, before time.Time, version, originalKey string, more map[string]any) string {
	var found, original, failure string
	var completed, data, authorized, native bool
	var first, last json.RawMessage
	var projection json.RawMessage
	fields := map[string]any{"version": &found, "completed": &completed, "sourceBefore": &first, "sourceAfter": &last, originalKey: &original, "projection": &projection, "failureCode": &failure, "dataOnly": &data, "authorized": &authorized, "nativeAdmission": &native}
	for k, v := range more {
		fields[k] = v
	}
	if !bytes.HasSuffix(raw, []byte("\n")) || decodeExactObject(bytes.TrimSuffix(raw, []byte("\n")), originalVerifierOutputLimit, fields) != nil || found != version || !completed || failure != "" || !data || authorized || native || len(original) == 0 || len(projection) == 0 {
		return "IDE_SOURCE_DISPATCH_RESULT"
	}
	if checkOriginalCurrentProcessOutput(append(bytes.Clone(first), '\n'), before) != "" || checkOriginalCurrentProcessOutput(append(bytes.Clone(last), '\n'), before) != "" {
		return "IDE_SOURCE_DISPATCH_CURRENT"
	}
	return ""
}
func originalIDEControlOutput(raw []byte, before time.Time) string {
	if e := originalIDEDispatchOutput(raw, before, "YNX-IDE-CONTROL-VERIFICATION-DATA/v1", "approvalOriginal", nil); e != "" {
		return e
	}
	var e struct {
		Projection originalIDEControlProjection `json:"projection"`
	}
	if json.Unmarshal(raw, &e) != nil {
		return "IDE_CONTROL_PROJECTION"
	}
	p := e.Projection
	if !p.Verified || !p.Data || p.Authorized || p.Committed || p.Native || !p.Ready || p.Decision != "approve" || p.Expires <= time.Now().UnixMilli() || !approvalHex.MatchString(p.Principal) || !approvalHex.MatchString(p.Binding) || !approvalHex.MatchString(p.Proof) || !text(p.Confirmation) || !text(p.Revocation) {
		return "IDE_CONTROL_PROJECTION"
	}
	return ""
}
func originalIDEPublisherOutput(raw []byte, before time.Time) string {
	var registered, custody bool
	if e := originalIDEDispatchOutput(raw, before, "YNX-IDE-PUBLISHER-CURRENT-VERIFICATION-DATA/v1", "registrationOriginal", map[string]any{"registered": &registered, "protectedCustodyAdmitted": &custody}); e != "" {
		return e
	}
	if registered || custody {
		return "IDE_PUBLISHER_UNEXPECTED_GRANT"
	}
	var e struct {
		Projection map[string]json.RawMessage `json:"projection"`
	}
	if json.Unmarshal(raw, &e) != nil {
		return "IDE_PUBLISHER_PROJECTION"
	}
	var signature, pair, data, authorized, native, reg, admitted bool
	var expires int64
	p := e.Projection
	for k, v := range map[string]any{"signatureVerified": &signature, "independentCustodianPairVerified": &pair, "dataOnly": &data, "authorized": &authorized, "nativeAdmission": &native, "registered": &reg, "protectedCustodyAdmitted": &admitted, "expiresAtMs": &expires} {
		if json.Unmarshal(p[k], v) != nil {
			return "IDE_PUBLISHER_PROJECTION"
		}
	}
	if !signature || !pair || !data || authorized || native || reg || admitted || expires <= time.Now().UnixMilli() {
		return "IDE_PUBLISHER_PROJECTION"
	}
	return ""
}
