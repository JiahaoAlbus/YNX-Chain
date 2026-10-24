package developerauthority

import (
	"bytes"
	"encoding/base64"
	"strconv"
	"unicode/utf8"
)

// Application transport only. The retained Native result is NOT a proof,
// approval, Source, registration or resource permit. Its complete original
// bytes must be pinned by the independent protected approval-current source.
const originalPublicationInputVersion = "YNX-IDE-PUBLICATION-INPUT/v1"

type originalPublicationResult struct {
	original, signature, public                                             []byte
	request, manifest, signatureEncoded, approval, registration, keyVersion string
	revision                                                                uint64
}

func (*originalPublicationResult) String() string {
	return "originalPublicationResult{retained DATA, not approval}"
}
func (r *originalPublicationResult) GoString() string { return r.String() }
func decodeOriginalPublicationResult(raw []byte) (*originalPublicationResult, error) {
	var version, purpose, request, manifest, invocation, publisher, signature, ref, registration, revision, keyVersion string
	if !utf8.Valid(raw) || decodeExactObject(raw, 262144, map[string]any{"version": &version, "purpose": &purpose, "requestOriginal": &request, "manifestOriginal": &manifest, "invocationOriginal": &invocation, "publisherOriginal": &publisher, "signatureOriginal": &signature, "actualApprovalRef": &ref, "publisherRegistrationRef": &registration, "publisherRevision": &revision, "publisherKeyVersion": &keyVersion}) != nil || version != "YNX-IDE-ARTIFACT-RELEASE-RESULT/v1" || purpose != "ARTIFACT-RELEASE" || len(request) < 1 || len(request) > 16384 || len(manifest) < 1 || len(manifest) > 16384 || manifest != invocation || !approvalUUID.MatchString(ref) || !text(registration) {
		return nil, ErrDenied
	}
	n, e := strconv.ParseUint(revision, 10, 64)
	if e != nil || n == 0 || strconv.FormatUint(n, 10) != revision {
		return nil, ErrDenied
	}
	k, e := strconv.ParseUint(keyVersion, 10, 64)
	if e != nil || k == 0 || strconv.FormatUint(k, 10) != keyVersion {
		return nil, ErrDenied
	}
	decode := func(s string, cap int) ([]byte, error) {
		if len(s) > ((cap+2)/3)*4 {
			return nil, ErrDenied
		}
		b, e := base64.RawURLEncoding.Strict().DecodeString(s)
		if e != nil || len(b) < 1 || len(b) > cap || base64.RawURLEncoding.EncodeToString(b) != s {
			return nil, ErrDenied
		}
		return b, nil
	}
	member, e := decode(signature, 100000)
	if e != nil {
		return nil, e
	}
	public, e := decode(publisher, 8192)
	if e != nil {
		return nil, e
	}
	return &originalPublicationResult{original: append([]byte(nil), raw...), signature: member, public: public, request: request, manifest: manifest, signatureEncoded: signature, approval: ref, registration: registration, keyVersion: keyVersion, revision: n}, nil
}
func (r *originalPublicationResult) matchesPublisher(k Publisher) bool {
	return r != nil && r.registration == k.RegistrationRef && r.revision == k.Revision && bytes.Equal(r.public, k.PublicOriginal) && hash(r.public) == k.PublicSHA256
}
