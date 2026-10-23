package developerauthority

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func publicManifest() []byte {
	b, _ := json.Marshal(ArtifactBinding{"project", "1", hash([]byte("artifact")), "build-artifact-publication", "testnet", 8})
	return b
}
func publicEnvelope() []byte {
	b, _ := json.Marshal(publicationEnvelope{"PUBLIC-original-request", "PUBLIC-N1-proof", string(publicManifest()), "PUBLIC-artifact-signature", "PUBLIC-protected-approval-ref"})
	return b
}
func TestPublicationTransportSeparateOriginalsAndLargePQBound(t *testing.T) {
	raw := publicEnvelope()
	e, err := publicationInput(raw)
	if err != nil || e.InvocationOriginal != string(publicManifest()) {
		t.Fatal(err)
	}
	e.SignatureOriginal = strings.Repeat("S", 100000)
	large, _ := json.Marshal(e)
	if len(large) <= 65536 {
		t.Fatal("not exercising dual-signature transport size")
	}
	if _, err = publicationInput(large); err != nil {
		t.Fatal("bounded large proof refused", err)
	}
	if _, err = publicationInput(bytes.Repeat([]byte("x"), PublicationEnvelopeLimit+1)); err == nil {
		t.Fatal("unbounded approval accepted")
	}
}
func TestPublicationManifestUnknownDuplicateAndTamperRefusal(t *testing.T) {
	raw := publicManifest()
	if _, e := artifactManifest(raw); e != nil {
		t.Fatal(e)
	}
	for _, bad := range [][]byte{[]byte(`{"projectId":"a","projectId":"b"}`), []byte(`{"publicKey":"self"}`), append(raw, []byte(`{}`)...)} {
		if _, e := artifactManifest(bad); e == nil {
			t.Fatal("ambiguous manifest accepted")
		}
	}
	var b map[string]any
	json.Unmarshal(raw, &b)
	for _, value := range []any{true, float64(1.5), -1} {
		b["byteSize"] = value
		bad, _ := json.Marshal(b)
		if _, e := artifactManifest(bad); e == nil {
			t.Fatal("bad artifact size")
		}
	}
}
func TestPublicationRequestIsNotProofOrArtifactSignature(t *testing.T) {
	for _, field := range []string{"requestOriginal", "proofOriginal", "invocationOriginal", "signatureOriginal", "actualApprovalRef"} {
		var packet map[string]any
		json.Unmarshal(publicEnvelope(), &packet)
		delete(packet, field)
		bad, _ := json.Marshal(packet)
		if _, e := publicationInput(bad); e == nil {
			t.Fatal("missing independent original accepted", field)
		}
	}
	raw := []byte(`{"requestOriginal":"x","requestOriginal":"y","proofOriginal":"z","invocationOriginal":"z","signatureOriginal":"z","actualApprovalRef":"z"}`)
	if _, e := publicationInput(raw); e == nil {
		t.Fatal("duplicate transport field")
	}
}
func TestPublicationResourcesRequireOwnApprovalAndBoundedLifetime(t *testing.T) {
	p := publicPrincipal()
	b, _ := artifactManifest(publicManifest())
	v := VerifiedPublication{RequestID: "original", ManifestSHA256: hash(publicManifest()), ExpiresMS: publicNow + 2000}
	r := ResourceApproval{Account: p.Account, ProjectID: b.ProjectID, RequestID: v.RequestID, ManifestSHA256: v.ManifestSHA256, ResourceID: "original-preexisting-resource", ResourceApprovalRef: "PUBLIC-approved-ref", ConfirmationRef: "PUBLIC-confirmation", RevocationRef: "PUBLIC-revoke", RuntimeSeconds: 30, ResourceValidUntilMS: publicNow + 60000, ExpiresMS: publicNow + 1000}
	if !resourceMatches(r, p, b, v, publicNow) {
		t.Fatal("PUBLIC exact binding refused")
	}
	for _, change := range []func(*ResourceApproval){func(r *ResourceApproval) { r.ResourceApprovalRef = "" }, func(r *ResourceApproval) { r.RuntimeSeconds = 301 }, func(r *ResourceApproval) { r.RequiresAdditionalCharge = true }, func(r *ResourceApproval) { r.ResourceValidUntilMS = publicNow + 1000 }, func(r *ResourceApproval) { r.ExpiresMS = publicNow }, func(r *ResourceApproval) { r.Account = "other-account" }} {
		bad := r
		change(&bad)
		if resourceMatches(bad, p, b, v, publicNow) {
			t.Fatal("resource approval widened")
		}
	}
}
func TestPublicationMissingOriginalProducerNeverTouchesDB(t *testing.T) {
	s := &publicSQL{}
	c := publicCatalog(t, s, &publicSource{p: publicPrincipal()})
	if _, e := c.AuthorizePublication(context.Background(), publicRequest(), publicManifest(), publicEnvelope()); e == nil || s.begins != 0 || writes(s) != 0 {
		t.Fatal("catalog or N1 request substituted for actual approval", e)
	}
}
