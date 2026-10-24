package developerauthority

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// PUBLIC approval/selector results exercise ONLY the real normal Catalog
// caller continuation. They are never constructors for a production Source,
// grant, crypto verification or root. Actual TLS principal/current and factory
// publisher reader remain the R216 real-method fixtures.
type r217PublicationSource struct {
	*r216CatalogReadSource
	key                          Publisher
	verified                     VerifiedPublication
	resource                     ResourceApproval
	artifactCalls, resourceCalls int
	denyArtifactCurrent          bool
}

func (s *r217PublicationSource) OriginalPublicationPublisherID(context.Context, Principal, []byte) (string, error) {
	return s.key.PublisherID, nil
}
func (s *r217PublicationSource) VerifyOriginalArtifactApproval(ctx context.Context, p Principal, a Access, k Publisher, b ArtifactBinding, manifest, request, proof, signature []byte, ref string) (VerifiedPublication, error) {
	s.artifactCalls++
	s.verified = VerifiedPublication{Account: p.Account, DeviceID: p.DeviceID, RequestID: "PUBLIC_PUBLICATION_REQUEST", PublisherID: k.PublisherID, PublisherPublicSHA256: k.PublicSHA256, ProjectCurrentReference: a.CurrentReference, PrincipalSHA256: objectHash(p), ManifestSHA256: hash(manifest), RequestSHA256: hash(request), ProofSHA256: hash(proof), SignatureSHA256: hash(signature), ActualApprovalRef: ref, ConfirmationRef: "PUBLIC_CONFIRM", RevocationRef: "PUBLIC_REVOKE", PublisherRevision: k.Revision, ExpiresMS: time.Now().Add(15 * time.Second).UnixMilli()}
	s.resource = ResourceApproval{Account: p.Account, ProjectID: b.ProjectID, RequestID: s.verified.RequestID, ManifestSHA256: s.verified.ManifestSHA256, ResourceID: "PUBLIC_EXISTING_RESOURCE", ResourceApprovalRef: "PUBLIC_RESOURCE_APPROVAL", ConfirmationRef: "PUBLIC_CONFIRM_RESOURCE", RevocationRef: "PUBLIC_REVOKE_RESOURCE", RuntimeSeconds: 1, ResourceValidUntilMS: k.ExpiresMS, ExpiresMS: s.verified.ExpiresMS}
	return s.verified, nil
}
func (s *r217PublicationSource) AssertOriginalArtifactApprovalCurrent(context.Context, Principal, VerifiedPublication) error {
	if s.denyArtifactCurrent {
		return ErrDenied
	}
	return nil
}
func (s *r217PublicationSource) VerifyOriginalResourceApproval(context.Context, Principal, VerifiedPublication) (ResourceApproval, error) {
	s.resourceCalls++
	return s.resource, nil
}
func (s *r217PublicationSource) AssertOriginalResourceApprovalCurrent(context.Context, Principal, ResourceApproval) error {
	return nil
}

func r217PublicationFixture(t *testing.T) (*Catalog, *r217PublicationSource, []byte, []byte) {
	t.Helper()
	f, state, p, k := r216ReaderFixture(t, "")
	db := sql.OpenDB(r216CatalogReadConnector{state})
	t.Cleanup(func() { db.Close() })
	s := &r217PublicationSource{r216CatalogReadSource: &r216CatalogReadSource{catalogPublisherSourceFixture: &catalogPublisherSourceFixture{p: p}, factory: f}, key: k}
	c, e := NewCatalog(db, s)
	if e != nil {
		t.Fatal(e)
	}
	manifest, _ := json.Marshal(ArtifactBinding{ProjectID: k.ProjectID, Version: "PUBLIC_VERSION", ContentDigest: strings.Repeat("a", 64), PublishPurpose: "PUBLIC_TEST", TargetEnvironment: "PUBLIC_NO_DEPLOY", ByteSize: 1})
	packet, _ := json.Marshal(publicationEnvelope{RequestOriginal: "PUBLIC_ORIGINAL_REQUEST", ProofOriginal: "PUBLIC_ORIGINAL_PROOF", InvocationOriginal: string(manifest), SignatureOriginal: "PUBLIC_SIGNATURE_FIXTURE_NOT_CRYPTO", ActualApprovalRef: "PUBLIC_APPROVAL_REF"})
	return c, s, manifest, packet
}
func TestR217PublicationNormalCallerDoesNotReplayOneHTTPRequest(t *testing.T) {
	c, s, manifest, packet := r217PublicationFixture(t)
	r := actualPrincipalRequest()
	r.Header.Set("x-request-id", "req_PUBLIC_PUBLICATION_FIRST_12345")
	permit, e := c.AuthorizePublication(context.Background(), r, manifest, packet)
	if e != nil || permit == nil {
		t.Fatal("normal production caller replays one HTTP credential", e)
	}
	if s.authentications != 1 || s.artifactCalls != 1 || s.resourceCalls != 1 {
		t.Fatal("authentication/approval replay", s.authentications, s.artifactCalls, s.resourceCalls)
	}
	second := actualPrincipalRequest()
	second.Header.Set("x-request-id", "req_PUBLIC_PUBLICATION_RECHECK_12345")
	if e = c.RecheckPermit(context.Background(), second, permit); e != nil {
		t.Fatal("fresh public recheck", e)
	}
	if s.authentications != 2 || s.artifactCalls != 1 || s.resourceCalls != 1 {
		t.Fatal("recheck repeated approval or authentication")
	}
}
func TestR217PublicationContinuationDoesNotSkipRevocation(t *testing.T) {
	c, s, manifest, packet := r217PublicationFixture(t)
	s.denyArtifactCurrent = true
	r := actualPrincipalRequest()
	r.Header.Set("x-request-id", "req_PUBLIC_PUBLICATION_REJECT_12345")
	if permit, e := c.AuthorizePublication(context.Background(), r, manifest, packet); e == nil || permit != nil {
		t.Fatal("revoked artifact accepted")
	}
	if s.authentications != 1 || s.artifactCalls != 1 || s.resourceCalls != 1 {
		t.Fatal("did not reach independent live approval guard", s.authentications, s.artifactCalls, s.resourceCalls)
	}
}
func TestR217ReadOperationNormalCallerDoesNotReplayOneHTTPRequest(t *testing.T) {
	c, s, _, _ := r217PublicationFixture(t)
	r := actualPrincipalRequest()
	r.Header.Set("x-request-id", "req_PUBLIC_READ_OPERATION_12345")
	o := OriginalOperation{RequestID: "PUBLIC_OPERATION", Account: s.key.Account, ProjectID: s.key.ProjectID, ManifestSHA256: strings.Repeat("a", 64)}
	if e := c.AuthorizeReadOperation(context.Background(), r, o); e != nil {
		t.Fatal("normal read operation replays HTTP credential", e)
	}
	if s.authentications != 1 || s.artifactCalls != 0 || s.resourceCalls != 0 {
		t.Fatal("read replayed principal or minted approval")
	}
}

func TestR217MalformedPermitStillFailsBeforeHTTPAuthentication(t *testing.T) {
	c, s, _, _ := r217PublicationFixture(t)
	r := actualPrincipalRequest()
	r.Header.Set("x-request-id", "req_PUBLIC_MALFORMED_PERMIT_12345")
	if e := c.RecheckPermit(context.Background(), r, &PublicationPermit{}); e == nil {
		t.Fatal("empty caller permit accepted")
	}
	if s.authentications != 0 || s.artifactCalls != 0 || s.resourceCalls != 0 {
		t.Fatal("malformed permit burned credential or selected approval")
	}
}
