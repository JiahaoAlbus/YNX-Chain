package developerauthority

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
)

func r227PublicationPacket(t *testing.T, k Publisher, manifest, member []byte) []byte {
	t.Helper()
	sig := base64.RawURLEncoding.EncodeToString(member)
	ref := "12345678-1234-4123-8123-123456789abc"
	result, e := json.Marshal(map[string]string{"version": "YNX-IDE-ARTIFACT-RELEASE-RESULT/v1", "purpose": "ARTIFACT-RELEASE", "requestOriginal": "PUBLIC_ORIGINAL_REQUEST", "manifestOriginal": string(manifest), "invocationOriginal": string(manifest), "publisherOriginal": base64.RawURLEncoding.EncodeToString(k.PublicOriginal), "signatureOriginal": sig, "actualApprovalRef": ref, "publisherRegistrationRef": k.RegistrationRef, "publisherRevision": strconv.FormatUint(k.Revision, 10), "publisherKeyVersion": "1"})
	if e != nil {
		t.Fatal(e)
	}
	packet, e := json.Marshal(publicationEnvelope{Version: originalPublicationInputVersion, RequestOriginal: "PUBLIC_ORIGINAL_REQUEST", ResultOriginal: string(result), InvocationOriginal: string(manifest), SignatureOriginal: sig, ActualApprovalRef: ref})
	if e != nil {
		t.Fatal(e)
	}
	return packet
}
func TestR227ResultDataIsOriginalBytesAndMemberDecodedOnce(t *testing.T) {
	manifest := []byte(`{"PUBLIC":"<>& literal\\u2028 not rebuilt"}`)
	key := Publisher{PublicOriginal: []byte("PUBLIC-independent-key"), RegistrationRef: "PUBLIC-reg", Revision: 9007199254740993}
	key.PublicSHA256 = hash(key.PublicOriginal)
	member := []byte{0, 255, 1, 254, 2, 253}
	packet := r227PublicationPacket(t, key, manifest, member)
	p, e := publicationInput(packet)
	if e != nil || p.retained == nil || !bytes.Equal(p.retained.signature, member) || !p.retained.matchesPublisher(key) || p.retained.manifest != string(manifest) || string(p.retained.original) != p.ResultOriginal {
		t.Fatal("exact original/member", e)
	}
	p.retained.signature[0] ^= 1
	if bytes.Equal(member, p.retained.signature) {
		t.Fatal("caller bytes aliased")
	}
}
func TestR227LegacyProofAndMismatchedResultNeverBecomePublication(t *testing.T) {
	key := Publisher{PublicOriginal: []byte("PUBLIC-key"), RegistrationRef: "PUBLIC-reg", Revision: 1}
	base := r227PublicationPacket(t, key, []byte(`{"PUBLIC":true}`), []byte("PUBLIC-member"))
	var m map[string]any
	if json.Unmarshal(base, &m) != nil {
		t.Fatal("fixture")
	}
	for _, change := range []func(map[string]any){func(v map[string]any) { v["proofOriginal"] = v["resultOriginal"]; delete(v, "resultOriginal") }, func(v map[string]any) { v["version"] = "PUBLIC-legacy" }, func(v map[string]any) { v["signatureOriginal"] = "TQ==" }, func(v map[string]any) { v["requestOriginal"] = "PUBLIC-substitute" }, func(v map[string]any) { v["invocationOriginal"] = "PUBLIC-substitute" }, func(v map[string]any) { v["actualApprovalRef"] = "87654321-1234-4123-8123-123456789abc" }} {
		var v map[string]any
		json.Unmarshal(base, &v)
		change(v)
		b, _ := json.Marshal(v)
		if _, e := publicationInput(b); e == nil {
			t.Fatal("legacy/mismatch accepted")
		}
	}
	raw := []byte(m["resultOriginal"].(string))
	for _, bad := range [][]byte{bytes.Replace(raw, []byte(`"version":`), []byte(`"version":"x","version":`), 1), bytes.Replace(raw, []byte(`"purpose":"ARTIFACT-RELEASE"`), []byte(`"purpose":"AUTH-IDENTITY-RECEIVE"`), 1), bytes.Replace(raw, []byte(`"publisherRevision":"1"`), []byte(`"publisherRevision":"01"`), 1), append(append([]byte(nil), raw...), []byte(`{}`)...)} {
		if _, e := decodeOriginalPublicationResult(bad); e == nil {
			t.Fatal("duplicate/domain/decimal/trailing accepted")
		}
	}
}

type r227MemberSource struct {
	*r217PublicationSource
	selected []byte
}

func (s *r227MemberSource) OriginalPublicationPublisherID(_ context.Context, _ Principal, member []byte) (string, error) {
	s.selected = append([]byte(nil), member...)
	return "", ErrDenied
}
func TestR227NormalCatalogPassesOriginalMemberNotBase64Text(t *testing.T) {
	c, base, manifest, _ := r217PublicationFixture(t)
	source := &r227MemberSource{r217PublicationSource: base}
	c.source = source
	member := []byte{0, 255, 1, 254, 2}
	packet := r227PublicationPacket(t, base.key, manifest, member)
	request := actualPrincipalRequest()
	request.Header.Set("x-request-id", "req_PUBLIC_R227_MEMBER_SELECT_12345")
	if permit, e := c.AuthorizePublication(context.Background(), request, manifest, packet); e == nil || permit != nil {
		t.Fatal("PUBLIC selector denial promoted")
	}
	if !bytes.Equal(source.selected, member) {
		t.Fatal("real caller double-encoded/failed to reach selector", source.selected)
	}
	if base.artifactCalls != 0 || base.resourceCalls != 0 {
		t.Fatal("failed selector reached approval")
	}
}
func TestR227ActualN1VectorSurvivesGoTransport(t *testing.T) {
	path := os.Getenv("YNX_R227_PUBLIC_VECTOR")
	if path == "" {
		t.Fatal("new actual PUBLIC N1 vector required")
	}
	raw, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	var v struct {
		Packet    string `json:"packet"`
		Member    string `json:"member"`
		Publisher string `json:"publisher"`
		Manifest  string `json:"manifest"`
	}
	if json.Unmarshal(raw, &v) != nil {
		t.Fatal("vector")
	}
	p, e := publicationInput([]byte(v.Packet))
	if e != nil || base64.RawURLEncoding.EncodeToString(p.retained.signature) != v.Member || base64.RawURLEncoding.EncodeToString(p.retained.public) != v.Publisher || p.retained.manifest != v.Manifest || !strings.Contains(p.ResultOriginal, "ARTIFACT-RELEASE") {
		t.Fatal("actual vector decoded/rebuilt", e)
	}
}
