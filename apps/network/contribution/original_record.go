package contribution

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"strings"
	"time"
	"unicode/utf8"
)

const OriginalLocalClass = "ORIGINAL_SOURCE_LOCAL_RECHECK_NOT_SERVICE"
const originalDocumentMax = 16384

// OriginalRecord keeps the actual SDK canonical UTF-8 originals, not a Go
// reconstruction or SANDBOX wrapper. ClaimOriginal is the Native recovery DATA,
// never a Source constructor or substitute authority database.
type OriginalRecord struct {
	ManifestOriginal []byte `json:"manifestOriginal"`
	ConsentOriginal  []byte `json:"consentOriginal"`
	ClaimOriginal    []byte `json:"claimOriginal,omitempty"`
	FirstCause       string `json:"firstCause,omitempty"`
	CleanupFailure   string `json:"cleanupFailure,omitempty"`
}

func cloneOriginal(v *OriginalRecord) *OriginalRecord {
	if v == nil {
		return nil
	}
	n := *v
	n.ManifestOriginal = bytes.Clone(v.ManifestOriginal)
	n.ConsentOriginal = bytes.Clone(v.ConsentOriginal)
	n.ClaimOriginal = bytes.Clone(v.ClaimOriginal)
	return &n
}
func recordManifest(rec Record) Binding {
	if rec.Original != nil {
		return Bind(rec.Original.ManifestOriginal)
	}
	return Bind(ManifestPayload(rec.Work))
}
func validRecordResult(rec Record) bool {
	if rec.Original == nil {
		return validResultForWork(rec.Work, rec.Result)
	}
	return rec.Work.Kind == PublicBlockHistogramKind && rec.Result.Job == rec.Work.Job && rec.Result.Manifest == recordManifest(rec) && rec.Result.Input == rec.Work.Input && validBinding(rec.Result.Output) && rec.Result.Output.Bytes == "1024"
}
func validOriginalReceipt(rec Record) bool {
	p := rec.Receipt
	n, e := strictUint(rec.Work.Input.Bytes)
	if e != nil || p == nil || p.ID != "source:"+rec.Work.Job || p.Class != OriginalLocalClass || p.Job != rec.Work.Job || p.Result != rec.Result || p.VerifiedBytes != n || !validRecordResult(rec) {
		return false
	}
	_, e = time.Parse(time.RFC3339Nano, p.VerifiedAt)
	return e == nil
}

// This is a strict bounded DATA decoder. It does not manufacture canonical
// bytes: original Auth/sole SDK verification is mandatory before admission.
func decodeOriginal(raw []byte, out any) error {
	if len(raw) == 0 || len(raw) > originalDocumentMax || !utf8.Valid(raw) || bytes.HasPrefix(raw, []byte{0xef, 0xbb, 0xbf}) || raw[0] != '{' || raw[len(raw)-1] != '}' {
		return ErrInvalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var visit func(int) error
	visit = func(depth int) error {
		if depth > 8 {
			return ErrInvalid
		}
		t, e := d.Token()
		if e != nil {
			return ErrInvalid
		}
		v, ok := t.(json.Delim)
		if !ok {
			return nil
		}
		if v != '{' {
			return ErrInvalid
		}
		seen := map[string]bool{}
		for d.More() {
			key, e := d.Token()
			s, ok := key.(string)
			if e != nil || !ok || seen[s] || len(seen) >= 32 {
				return ErrInvalid
			}
			seen[s] = true
			if e = visit(depth + 1); e != nil {
				return e
			}
		}
		_, e = d.Token()
		return e
	}
	if visit(0) != nil {
		return ErrInvalid
	}
	if _, e := d.Token(); e != io.EOF {
		return ErrInvalid
	}
	d = json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil {
		return ErrInvalid
	}
	return nil
}
func originalDocuments(manifest, consent []byte) (Work, Consent, error) {
	var w Work
	var c Consent
	if decodeOriginal(manifest, &w) != nil || decodeOriginal(consent, &c) != nil || w.Kind != PublicBlockHistogramKind || !boundedMetadata(w) || !validID(w.Job) || !validID(w.Issuer) || !validID(c.Principal) || !validID(c.Nonce) || !validBinding(w.Input) || !c.Allow || c.Job != w.Job || c.Manifest != Bind(manifest) || c.Limits != w.Limits || nonceKey(c.Principal, c.Nonce) == "" {
		return w, c, ErrInvalid
	}
	for _, s := range []string{w.ExpiresAt, c.ExpiresAt} {
		if len(s) > 64 || !strings.HasSuffix(s, "Z") {
			return w, c, ErrInvalid
		}
		if _, e := time.Parse(time.RFC3339Nano, s); e != nil {
			return w, c, ErrInvalid
		}
	}
	if w.Limits.StorageBytes != "0" || w.Limits.EgressBytes != "0" {
		return w, c, ErrLimit
	}
	return w, c, nil
}

func validateOriginalRecord(rec Record) error {
	o := rec.Original
	w, c, e := originalDocuments(o.ManifestOriginal, o.ConsentOriginal)
	if e != nil || w != rec.Work || nonceKey(c.Principal, c.Nonce) != rec.ConsentNonce || len(o.FirstCause) > 4096 || len(o.CleanupFailure) > 4096 {
		return ErrInvalid
	}
	if len(o.ClaimOriginal) == 0 {
		if rec.State == "unknown" {
			return nil
		}
		return ErrInvalid
	}
	return validateOnceOriginal(o.ClaimOriginal, w, c, o.ManifestOriginal, o.ConsentOriginal)
}

// Mirrors only the documented fixed Native original record framing for DATA
// identity checks. No once file/path/permission is created from these bytes.
func validateOnceOriginal(raw []byte, w Work, c Consent, manifest, consent []byte) error {
	if len(raw) == 0 || len(raw) > 65536 {
		return ErrInvalid
	}
	var fields [][]byte
	for len(raw) > 0 {
		if len(raw) < 4 {
			return ErrInvalid
		}
		n := binary.BigEndian.Uint32(raw[:4])
		raw = raw[4:]
		if uint64(n) > uint64(len(raw)) || len(fields) >= 8 {
			return ErrInvalid
		}
		fields = append(fields, raw[:n])
		raw = raw[n:]
	}
	if len(fields) != 8 || string(fields[0]) != "YNX-NETWORK-RESOURCE-ONCE/V1" || string(fields[1]) != c.Principal || string(fields[2]) != c.Nonce || string(fields[3]) != w.Job || !validID(string(fields[4])) || !validID(string(fields[5])) || !bytes.Equal(fields[6], manifest) || !bytes.Equal(fields[7], consent) {
		return ErrInvalid
	}
	return nil
}
