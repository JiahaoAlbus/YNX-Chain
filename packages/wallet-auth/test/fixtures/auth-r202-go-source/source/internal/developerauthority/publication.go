package developerauthority

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"
)

const PublicationEnvelopeLimit = 1 << 20

// These are transport limits, never an independent signature domain/codec.
// Final Protocol/SDK member-frame caps must match before production activation.
type ArtifactBinding struct {
	ProjectID         string `json:"projectId"`
	Version           string `json:"version"`
	ContentDigest     string `json:"contentDigest"`
	PublishPurpose    string `json:"publishPurpose"`
	TargetEnvironment string `json:"targetEnvironment"`
	ByteSize          int64  `json:"byteSize"`
}
type publicationEnvelope struct {
	RequestOriginal    string `json:"requestOriginal"`
	ProofOriginal      string `json:"proofOriginal"`
	InvocationOriginal string `json:"invocationOriginal"`
	SignatureOriginal  string `json:"signatureOriginal"`
	ActualApprovalRef  string `json:"actualApprovalRef"`
}

// Returned only by genuine normal native/SDK verification plus the original
// protected approval/registry owner. Mathematical N1 DATA alone is NOT this.
type VerifiedPublication struct {
	Account, DeviceID, RequestID, PublisherID, PublisherPublicSHA256, ProjectCurrentReference string
	PrincipalSHA256, ManifestSHA256, RequestSHA256, ProofSHA256, SignatureSHA256              string
	ActualApprovalRef, ConfirmationRef, RevocationRef                                         string
	PublisherRevision                                                                         uint64
	ExpiresMS                                                                                 int64
}
type ResourceApproval struct {
	Account, ProjectID, RequestID, ManifestSHA256, ResourceID, ResourceApprovalRef, ConfirmationRef, RevocationRef string
	RuntimeSeconds                                                                                                 int
	ResourceValidUntilMS                                                                                           int64
	ExpiresMS                                                                                                      int64
	RequiresAdditionalCharge                                                                                       bool
}
type OriginalPublicationSource interface {
	VerifyOriginalArtifactApproval(context.Context, Principal, Access, Publisher, ArtifactBinding, []byte, []byte, []byte, []byte, string) (VerifiedPublication, error)
	AssertOriginalArtifactApprovalCurrent(context.Context, Principal, VerifiedPublication) error
	VerifyOriginalResourceApproval(context.Context, Principal, VerifiedPublication) (ResourceApproval, error)
	AssertOriginalResourceApprovalCurrent(context.Context, Principal, ResourceApproval) error
}

// Selector is DATA only; native signature verification and CurrentPublisher
// must independently authenticate the selected original registry entry.
type OriginalPublicationSelector interface {
	OriginalPublicationPublisherID(context.Context, Principal, []byte) (string, error)
}
type PublicationPermit struct {
	RequestID, Principal, PublisherID, ResourceID, ResourceApprovalRef, ApprovalSHA256, ManifestSHA256 string
	Binding                                                                                            ArtifactBinding
	RuntimeSeconds                                                                                     int
	ExpiresMS                                                                                          int64
	RequiresAdditionalCharge                                                                           bool
	// Original proof/request/signature stay private; Cloud must not journal or
	// expose them as a reusable grant. Call RecheckPermit immediately at effects.
	originalPrincipal      Principal
	access                 Access
	publisher              Publisher
	verified               VerifiedPublication
	resource               ResourceApproval
	originalManifest       []byte
	originalApprovalSHA256 string
}
type OriginalOperation struct{ RequestID, Account, ProjectID, PublisherID, ResourceID, ManifestSHA256 string }

func decodeExactObject(raw []byte, limit int, fields map[string]any) error {
	if len(raw) == 0 || len(raw) > limit || !utf8.Valid(raw) {
		return ErrDenied
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, e := d.Token()
	if e != nil || token != json.Delim('{') {
		return ErrDenied
	}
	seen := map[string]bool{}
	for d.More() {
		token, e = d.Token()
		name, ok := token.(string)
		if e != nil || !ok || seen[name] {
			return ErrDenied
		}
		into, ok := fields[name]
		if !ok {
			return ErrDenied
		}
		seen[name] = true
		if e = d.Decode(into); e != nil {
			return ErrDenied
		}
	}
	token, e = d.Token()
	if e != nil || token != json.Delim('}') || len(seen) != len(fields) {
		return ErrDenied
	}
	if _, e = d.Token(); e != io.EOF {
		return ErrDenied
	}
	return nil
}
func manifestText(s string) bool {
	return s != "" && len(s) <= 256 && utf8.ValidString(s) && strings.TrimSpace(s) == s && strings.IndexFunc(s, unicode.IsControl) < 0
}
func artifactManifest(raw []byte) (ArtifactBinding, error) {
	var b ArtifactBinding
	e := decodeExactObject(raw, 16384, map[string]any{"projectId": &b.ProjectID, "version": &b.Version, "contentDigest": &b.ContentDigest, "publishPurpose": &b.PublishPurpose, "targetEnvironment": &b.TargetEnvironment, "byteSize": &b.ByteSize})
	digest, de := hex.DecodeString(b.ContentDigest)
	if e != nil || !manifestText(b.ProjectID) || !manifestText(b.Version) || !manifestText(b.PublishPurpose) || !manifestText(b.TargetEnvironment) || de != nil || len(digest) != 32 || hex.EncodeToString(digest) != b.ContentDigest || b.ByteSize < 1 || b.ByteSize > 67108864 {
		return ArtifactBinding{}, ErrDenied
	}
	return b, nil
}
func publicationInput(raw []byte) (publicationEnvelope, error) {
	var p publicationEnvelope
	e := decodeExactObject(raw, PublicationEnvelopeLimit, map[string]any{"requestOriginal": &p.RequestOriginal, "proofOriginal": &p.ProofOriginal, "invocationOriginal": &p.InvocationOriginal, "signatureOriginal": &p.SignatureOriginal, "actualApprovalRef": &p.ActualApprovalRef})
	if e != nil || len(p.RequestOriginal) == 0 || len(p.RequestOriginal) > 16384 || len(p.ProofOriginal) == 0 || len(p.ProofOriginal) > 393216 || len(p.InvocationOriginal) == 0 || len(p.InvocationOriginal) > 16384 || len(p.SignatureOriginal) == 0 || len(p.SignatureOriginal) > 393216 || !text(p.ActualApprovalRef) {
		return publicationEnvelope{}, ErrDenied
	}
	return p, nil
}
func verifiedPublicationMatches(v VerifiedPublication, p Principal, a Access, key Publisher, manifest []byte, envelope publicationEnvelope, now int64) bool {
	return v.Account == p.Account && v.DeviceID == p.DeviceID && text(v.RequestID) && v.PublisherID == key.PublisherID && v.PublisherPublicSHA256 == key.PublicSHA256 && v.PublisherRevision == key.Revision && v.ProjectCurrentReference == a.CurrentReference && v.PrincipalSHA256 == objectHash(p) && v.ManifestSHA256 == hash(manifest) && v.RequestSHA256 == hash([]byte(envelope.RequestOriginal)) && v.ProofSHA256 == hash([]byte(envelope.ProofOriginal)) && v.SignatureSHA256 == hash([]byte(envelope.SignatureOriginal)) && v.ActualApprovalRef == envelope.ActualApprovalRef && text(v.ConfirmationRef) && text(v.RevocationRef) && v.ExpiresMS > now && v.ExpiresMS <= p.ExpiresMS && v.ExpiresMS <= a.ExpiresMS && v.ExpiresMS <= key.ExpiresMS
}
func resourceMatches(r ResourceApproval, p Principal, b ArtifactBinding, v VerifiedPublication, now int64) bool {
	return r.Account == p.Account && r.ProjectID == b.ProjectID && r.RequestID == v.RequestID && r.ManifestSHA256 == v.ManifestSHA256 && text(r.ResourceID) && text(r.ResourceApprovalRef) && text(r.ConfirmationRef) && text(r.RevocationRef) && r.RuntimeSeconds > 0 && r.RuntimeSeconds <= 300 && r.ResourceValidUntilMS >= now && int64(r.RuntimeSeconds) <= (r.ResourceValidUntilMS-now)/1000 && !r.RequiresAdditionalCharge && r.ExpiresMS > now && r.ExpiresMS <= v.ExpiresMS
}

// Publication authorizes only an EXISTING specifically approved resource.
// It creates no account, key, lease, image pull, payment or deployment. Actual
// Cloud executor owns once-dispatch and its durable UNKNOWN operation journal.
func (c *Catalog) AuthorizePublication(ctx context.Context, request *http.Request, manifestRaw, approvalRaw []byte) (*PublicationPermit, error) {
	source, ok := c.source.(OriginalPublicationSource)
	if !ok || ctx == nil || request == nil {
		return nil, ErrDenied
	}
	manifest := append([]byte(nil), manifestRaw...)
	packet := append([]byte(nil), approvalRaw...)
	binding, e := artifactManifest(manifest)
	if e != nil {
		return nil, e
	}
	envelope, e := publicationInput(packet)
	if e != nil || envelope.InvocationOriginal != string(manifest) {
		return nil, ErrDenied
	}
	principal, e := c.Principal(ctx, request)
	if e != nil {
		return nil, e
	}
	access, e := c.CurrentProject(ctx, request, binding.ProjectID)
	if e != nil || !access.Publish || access.Principal != principal {
		return nil, ErrDenied
	}
	// Publisher identity is selected from ORIGINAL verified signing result, not
	// from manifest self-attestation. The Source first extracts/authenticates its
	// registered publisher ID, then CurrentPublisher independently reads registry.
	selector, ok := c.source.(OriginalPublicationSelector)
	if !ok {
		return nil, ErrDenied
	}
	id, e := selector.OriginalPublicationPublisherID(ctx, principal, []byte(envelope.SignatureOriginal))
	if e != nil || !text(id) {
		return nil, ErrDenied
	}
	publisher, e := c.CurrentPublisher(ctx, request, binding.ProjectID, id)
	if e != nil {
		return nil, e
	}
	keyForVerifier := publisher
	keyForVerifier.PublicOriginal = append([]byte(nil), publisher.PublicOriginal...)
	v, e := source.VerifyOriginalArtifactApproval(ctx, principal, access, keyForVerifier, binding, append([]byte(nil), manifest...), []byte(envelope.RequestOriginal), []byte(envelope.ProofOriginal), []byte(envelope.SignatureOriginal), envelope.ActualApprovalRef)
	if e != nil || !verifiedPublicationMatches(v, principal, access, publisher, manifest, envelope, c.now().UnixMilli()) {
		return nil, ErrDenied
	}
	resource, e := source.VerifyOriginalResourceApproval(ctx, principal, v)
	if e != nil || !resourceMatches(resource, principal, binding, v, c.now().UnixMilli()) {
		return nil, ErrDenied
	}
	permit := &PublicationPermit{RequestID: v.RequestID, Principal: principal.Account, PublisherID: publisher.PublisherID, ResourceID: resource.ResourceID, ResourceApprovalRef: resource.ResourceApprovalRef, ApprovalSHA256: hash(packet), ManifestSHA256: hash(manifest), Binding: binding, RuntimeSeconds: resource.RuntimeSeconds, ExpiresMS: resource.ExpiresMS, originalPrincipal: principal, access: access, publisher: publisher, verified: v, resource: resource, originalManifest: manifest, originalApprovalSHA256: hash(packet)}
	if e = c.RecheckPermit(ctx, request, permit); e != nil {
		return nil, e
	}
	return permit, nil
}
func (c *Catalog) RecheckPermit(ctx context.Context, request *http.Request, permit *PublicationPermit) error {
	source, ok := c.source.(OriginalPublicationSource)
	if !ok || ctx == nil || request == nil || permit == nil {
		return ErrDenied
	}
	if permit.RequiresAdditionalCharge || permit.ApprovalSHA256 != permit.originalApprovalSHA256 || permit.ManifestSHA256 != hash(permit.originalManifest) || permit.RequestID != permit.verified.RequestID || permit.Principal != permit.originalPrincipal.Account || permit.PublisherID != permit.publisher.PublisherID || permit.ResourceID != permit.resource.ResourceID || permit.ResourceApprovalRef != permit.resource.ResourceApprovalRef || permit.RuntimeSeconds != permit.resource.RuntimeSeconds || permit.ExpiresMS != permit.resource.ExpiresMS {
		return ErrDenied
	}
	binding, e := artifactManifest(permit.originalManifest)
	if e != nil || binding != permit.Binding {
		return ErrDenied
	}
	p, e := c.Principal(ctx, request)
	if e != nil || p != permit.originalPrincipal {
		return ErrDenied
	}
	if e = c.RecheckProject(ctx, request, permit.access); e != nil {
		return e
	}
	key, e := c.CurrentPublisher(ctx, request, binding.ProjectID, permit.PublisherID)
	if e != nil || key.Account != permit.publisher.Account || key.Revision != permit.publisher.Revision || key.PublicSHA256 != permit.publisher.PublicSHA256 || key.RegistrationRef != permit.publisher.RegistrationRef {
		return ErrDenied
	}
	if e = source.AssertOriginalArtifactApprovalCurrent(ctx, p, permit.verified); e != nil {
		return ErrDenied
	}
	if e = source.AssertOriginalResourceApprovalCurrent(ctx, p, permit.resource); e != nil {
		return ErrDenied
	}
	if e = c.RecheckProject(ctx, request, permit.access); e != nil {
		return e
	}
	lastKey, e := c.CurrentPublisher(ctx, request, binding.ProjectID, permit.PublisherID)
	if e != nil || lastKey.Revision != permit.publisher.Revision || lastKey.PublicSHA256 != permit.publisher.PublicSHA256 || lastKey.RegistrationRef != permit.publisher.RegistrationRef {
		return ErrDenied
	}
	if permit.ExpiresMS <= c.now().UnixMilli() || permit.verified.ExpiresMS <= c.now().UnixMilli() || key.ExpiresMS <= c.now().UnixMilli() {
		return ErrDenied
	}
	if !resourceMatches(permit.resource, p, binding, permit.verified, c.now().UnixMilli()) {
		return ErrDenied
	}
	return nil
}

// original must be read by Cloud from its own protected original operation
// journal, never decoded from caller account/project fields or a URL hostname.
func (c *Catalog) AuthorizeReadOperation(ctx context.Context, request *http.Request, original OriginalOperation) error {
	if !text(original.RequestID) || !text(original.Account) || !text(original.ProjectID) || len(original.ManifestSHA256) != 64 {
		return ErrDenied
	}
	p, e := c.Principal(ctx, request)
	if e != nil || original.Account != p.Account {
		return ErrDenied
	}
	access, e := c.CurrentProject(ctx, request, original.ProjectID)
	if e != nil || !access.Read || access.Principal != p {
		return ErrDenied
	}
	return c.RecheckProject(ctx, request, access)
}
