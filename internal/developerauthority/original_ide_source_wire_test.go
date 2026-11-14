package developerauthority

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestOriginalIDEWireMemberIsDecodedOnceAndProducerCapPreserved(t *testing.T) {
	raw := []byte{0, 1, 2, 3, 254, 255}
	wire := []byte(base64.RawURLEncoding.EncodeToString(raw))
	b, e := originalIDEArtifactMember(wire)
	if e != nil || !bytes.Equal(b, raw) || bytes.Equal(b, wire) {
		t.Fatal("not original member", e)
	}
	for _, bad := range []string{string(wire) + "=", base64.StdEncoding.EncodeToString(raw), " " + string(wire), string(wire) + "\n", "", "AA_", base64.RawURLEncoding.EncodeToString(make([]byte, 98305))} {
		if _, e := originalIDEArtifactMember([]byte(bad)); e == nil {
			t.Fatal("accepted alias/cap", len(bad))
		}
	}
}
func TestOriginalIDEWireRejectsLegacyFiveFieldProofAndBindsNativeRaw(t *testing.T) {
	old := []byte(`{"requestOriginal":"a","proofOriginal":"b","invocationOriginal":"c","signatureOriginal":"d","actualApprovalRef":"e"}`)
	if _, e := publicationInput(old); e == nil {
		t.Fatal("legacy proof admitted")
	}
	key := Publisher{RegistrationRef: "registered", Revision: 9, PublicOriginal: []byte("PUBLIC-R13")}
	request := []byte(`{"requestId":"req_original"}`)
	manifest := []byte(`{"projectId":"p"}`)
	sig := []byte(base64.RawURLEncoding.EncodeToString([]byte("PUBLIC-MEMBER")))
	fields := map[string]string{"version": "YNX-IDE-ARTIFACT-RELEASE-RESULT/v1", "purpose": "ARTIFACT-RELEASE", "requestOriginal": string(request), "manifestOriginal": string(manifest), "publisherOriginal": base64.RawURLEncoding.EncodeToString(key.PublicOriginal), "actualApprovalRef": "approval", "publisherRegistrationRef": key.RegistrationRef, "publisherRevision": "9", "publisherKeyVersion": "5", "invocationOriginal": string(manifest), "signatureOriginal": string(sig)}
	native, _ := originalIDEJSON(fields)
	if _, e := originalIDEReadArtifactResult(native, request, manifest, sig, key, "approval"); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"requestOriginal", "invocationOriginal", "signatureOriginal", "actualApprovalRef", "publisherRegistrationRef", "publisherRevision"} {
		changed := make(map[string]string)
		for k, v := range fields {
			changed[k] = v
		}
		changed[name] += "changed"
		b, _ := originalIDEJSON(changed)
		if _, e := originalIDEReadArtifactResult(b, request, manifest, sig, key, "approval"); e == nil {
			t.Fatal("unbound", name)
		}
	}
	packet, _ := originalIDEJSON(map[string]string{"version": "YNX-IDE-PUBLICATION-INPUT/v1", "requestOriginal": string(request), "resultOriginal": string(native), "invocationOriginal": string(manifest), "signatureOriginal": string(sig), "actualApprovalRef": "approval"})
	parsed, e := publicationInput(packet)
	if e != nil || parsed.ResultOriginal != string(native) {
		t.Fatal("raw replaced", e)
	}
	spaced := bytes.Replace(native, []byte(`,"purpose"`), []byte(",\n\"purpose\""), 1)
	if bytes.Equal(spaced, native) || hash(spaced) == hash(native) {
		t.Fatal("same-value raw drift not observable")
	}
	// Approval binding must use the original full result, never reserialized DTO.
	p := Principal{Account: "a", DeviceID: "d", ExpiresMS: 1000}
	a := Access{CurrentReference: "current", ExpiresMS: 1000}
	key.PublisherID = "publisher"
	key.PublicSHA256 = hash(key.PublicOriginal)
	key.ExpiresMS = 1000
	v := VerifiedPublication{Account: p.Account, DeviceID: p.DeviceID, RequestID: "request", PublisherID: key.PublisherID, PublisherPublicSHA256: key.PublicSHA256, PublisherRevision: key.Revision, ProjectCurrentReference: a.CurrentReference, PrincipalSHA256: objectHash(p), ManifestSHA256: hash(manifest), RequestSHA256: hash(request), ResultSHA256: hash(native), SignatureSHA256: hash(sig), ActualApprovalRef: parsed.ActualApprovalRef, ConfirmationRef: "confirmed", RevocationRef: "revoked", ExpiresMS: 900}
	if !verifiedPublicationMatches(v, p, a, key, manifest, parsed, 100) {
		t.Fatal("positive original tuple did not match")
	}
	parsed.ResultOriginal = string(spaced)
	if verifiedPublicationMatches(v, p, a, key, manifest, parsed, 100) {
		t.Fatal("raw result reserialization accepted against original current binding")
	}
}
func TestOriginalIDEWireCanonicalTransportKeepsUnicodeAndLargeIntegers(t *testing.T) {
	raw, e := originalIDEJSON(map[string]any{"str": "<&>\u2028\\u2028", "number": json.Number("18446744073709551615")})
	if e != nil || strings.Contains(string(raw), `\u003c`) || !strings.Contains(string(raw), "18446744073709551615") || !bytes.Contains(raw, []byte("\u2028")) {
		t.Fatal(string(raw), e)
	}
}
