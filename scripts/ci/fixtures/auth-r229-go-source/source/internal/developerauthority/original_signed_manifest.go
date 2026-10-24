package developerauthority

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"time"
)

// Actual original member mathematics plus retained exact embedded manifest.
// This is not a registered publisher, approval or resource capability.
type originalSignedManifest struct {
	manifest, original                                      []byte
	binding                                                 ArtifactBinding
	account, project, publisher, keyVersion, owner, network string
}

func (*originalSignedManifest) String() string {
	return "originalSignedManifest{retained N1 DATA; not registration or approval}"
}
func (v *originalSignedManifest) GoString() string { return v.String() }

func decodeOriginalSignedManifest(raw []byte) (*originalSignedManifest, error) {
	if !bytes.HasSuffix(raw, []byte("\n")) {
		return nil, ErrDenied
	}
	keys := []string{"networkId", "subjectOwner", "account", "projectId", "publisherId", "publisherKeyVersion", "purpose", "keyRole", "signatureVerified", "memberCount", "memberIndex", "dataOnly", "trusted", "authorized", "nativeAdmission", "registered", "current", "publicationAuthorized", "manifestOriginal"}
	fields := map[string]any{}
	values := map[string]*json.RawMessage{}
	for _, k := range keys {
		v := new(json.RawMessage)
		values[k] = v
		fields[k] = v
	}
	if decodeExactObject(bytes.TrimSuffix(raw, []byte("\n")), 28672, fields) != nil {
		return nil, ErrDenied
	}
	metadata := map[string]json.RawMessage{}
	for _, k := range keys {
		if k != "manifestOriginal" {
			metadata[k] = *values[k]
		}
	}
	// Only unsigned projection metadata is encoded for the existing validator;
	// original signature/public/manifest buffers are never reconstructed.
	projection, e := json.Marshal(metadata)
	if e != nil || checkOriginalArtifactProcessOutput(append(projection, '\n'), time.Now()) != "" {
		return nil, ErrDenied
	}
	var encoded string
	if json.Unmarshal(*values["manifestOriginal"], &encoded) != nil {
		return nil, ErrDenied
	}
	manifest, e := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if e != nil || len(manifest) == 0 || len(manifest) > 16384 || base64.RawURLEncoding.EncodeToString(manifest) != encoded {
		return nil, ErrDenied
	}
	b, e := artifactManifest(manifest)
	if e != nil {
		return nil, e
	}
	r := &originalSignedManifest{manifest: append([]byte(nil), manifest...), original: append([]byte(nil), raw...), binding: b}
	for k, p := range map[string]*string{"account": &r.account, "projectId": &r.project, "publisherId": &r.publisher, "publisherKeyVersion": &r.keyVersion, "subjectOwner": &r.owner, "networkId": &r.network} {
		if json.Unmarshal(*values[k], p) != nil {
			return nil, ErrDenied
		}
	}
	if r.project != b.ProjectID {
		return nil, ErrDenied
	}
	return r, nil
}

// Same actual complete-file pinned process and fixed SDK branch. The expected
// public must be independently selected/current by the normal Source owner.
func (o *OriginalSourceVerifierOwner) inspectOriginalSignedManifest(ctx context.Context, signature, expectedPublic []byte) (*originalSignedManifest, error) {
	if len(signature) == 0 || len(signature) > 100000 || len(expectedPublic) == 0 || len(expectedPublic) > 8192 {
		return nil, ErrDenied
	}
	encode := base64.RawURLEncoding.EncodeToString
	input, e := json.Marshal(map[string]string{"operation": "ide-artifact-signed-manifest-data/v1", "signatureOriginal": encode(signature), "expectedPublicOriginal": encode(expectedPublic)})
	if e != nil || len(input) > 262144 {
		return nil, ErrDenied
	}
	var selected *originalSignedManifest
	raw, e := o.invokeDATA(ctx, input, 28673, true, func(raw []byte, _ time.Time) string {
		var e error
		selected, e = decodeOriginalSignedManifest(raw)
		if e != nil {
			return "SIGNED_MANIFEST_OUTPUT"
		}
		return ""
	})
	if e != nil {
		return selected, e
	}
	if selected == nil || !bytes.Equal(selected.original, raw) {
		return selected, ErrUnknown
	}
	return selected, nil
}
