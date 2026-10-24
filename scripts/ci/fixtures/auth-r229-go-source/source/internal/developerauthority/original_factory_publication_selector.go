package developerauthority

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"time"
)

type originalFactoryPublicationSelection struct {
	principal   Principal
	signature   []byte
	key         Publisher
	first       originalControlSourceProjection
	mathematics *originalSignedManifest
	result      error
}

func (*originalFactoryPublicationSelection) String() string {
	return "originalFactoryPublicationSelection{originals/partials private; DATA not approval}"
}
func (v *originalFactoryPublicationSelection) GoString() string { return v.String() }

func originalFactorySelectedPublisher(s originalControlSourceProjection, p Principal, at int64) (Publisher, error) {
	var selection struct {
		Authority struct {
			Publisher json.RawMessage `json:"publisher"`
		} `json:"projectAuthority"`
	}
	if json.Unmarshal(s.Selection, &selection) != nil {
		return Publisher{}, ErrDenied
	}
	var k Publisher
	var encoded, revision string
	if decodeExactObject(selection.Authority.Publisher, 16384, map[string]any{"account": &k.Account, "projectId": &k.ProjectID, "publisherId": &k.PublisherID, "keyRole": &k.KeyRole, "publicOriginal": &encoded, "publicSHA256": &k.PublicSHA256, "registrationRef": &k.RegistrationRef, "revision": &revision, "expiresMS": &k.ExpiresMS, "revoked": &k.Revoked}) != nil {
		return k, ErrDenied
	}
	raw, e := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if e != nil || len(raw) == 0 || len(raw) > 8192 || base64.RawURLEncoding.EncodeToString(raw) != encoded {
		return k, ErrDenied
	}
	k.PublicOriginal = append([]byte(nil), raw...)
	k.Revision, e = strconv.ParseUint(revision, 10, 64)
	if e != nil || k.Revision == 0 || strconv.FormatUint(k.Revision, 10) != revision || !originalFactoryProjectPublisherMatches(s, p, k, at) {
		return k, ErrDenied
	}
	return k, nil
}

// Same original registered project Source, never a publisher id/public key
// extracted from a caller's signature or JSON and then treated as authority.
func (o *OriginalDeveloperSourceFactory) readOriginalSelectedPublisher(ctx context.Context, p Principal) (originalControlSourceProjection, Publisher, error) {
	c := o.control
	c.mu.Lock()
	defer c.mu.Unlock()
	v := o.publisher
	if c.closeSelected || c.firstCause != nil || c.now == nil {
		return originalControlSourceProjection{}, Publisher{}, ErrUnknown
	}
	before := c.now()
	raw, e := c.verifier.InvokeOriginalCurrentDATA(ctx, v.projectSource)
	if len(raw) > 0 {
		v.lastProjectOriginal = append([]byte(nil), raw...)
		v.projectOriginals = append(v.projectOriginals, append([]byte(nil), raw...))
	}
	if e != nil {
		return originalControlSourceProjection{}, Publisher{}, e
	}
	s, e := controlSourceProjection(bytes.TrimSuffix(raw, []byte("\n")), before)
	if e != nil || s.Profile != v.projectProfile {
		return s, Publisher{}, ErrDenied
	}
	k, e := originalFactorySelectedPublisher(s, p, c.now().UnixMilli())
	if e != nil {
		return s, k, e
	}
	if e = c.observeCurrent(ctx, &originalControlCurrent{sourceID: s.SourceID, instanceID: s.InstanceID, profile: s.Profile, generation: s.Generation, sequence: s.Sequence, floor: s.Floor, head: s.Head}); e != nil {
		return s, k, e
	}
	at := c.now().UnixMilli()
	if ctx.Err() != nil || at < before.UnixMilli() || !principalValid(p, at) || !originalFactoryProjectPublisherMatches(s, p, k, at) {
		v.firstCause = ErrUnknown
		return s, k, ErrUnknown
	}
	return s, k, nil
}

func sameOriginalProjectSelection(a, b originalControlSourceProjection) bool {
	ah, ae := strconv.ParseUint(a.Height, 10, 64)
	bh, be := strconv.ParseUint(b.Height, 10, 64)
	return ae == nil && be == nil && bh >= ah && b.TimeFloor >= a.TimeFloor && a.Principal == b.Principal && a.Status == "active" && b.Status == "active" && a.SourceID == b.SourceID && a.InstanceID == b.InstanceID && a.Profile == b.Profile && a.Owner == b.Owner && a.KeyVersion == b.KeyVersion && a.Generation == b.Generation && a.Sequence == b.Sequence && a.Floor == b.Floor && a.Head == b.Head && bytes.Equal(a.Selection, b.Selection)
}

func (o *OriginalDeveloperSourceFactory) recheckOriginalPublicationSelection(ctx context.Context, r *originalFactoryPublicationSelection) error {
	if r == nil || r.mathematics == nil || r.result != nil {
		return ErrUnknown
	}
	if e := o.assertPublisherCurrentLocked(ctx, r.principal, r.key); e != nil {
		return e
	}
	last := o.publisher.lastProjectProjection
	at := o.control.now().UnixMilli()
	if last == nil || !sameOriginalProjectSelection(r.first, *last) || !principalValid(r.principal, at) || !originalFactoryProjectPublisherMatches(*last, r.principal, r.key, at) {
		return ErrUnknown
	}
	return nil
}

// Data-only selector. Real original N1 mathematics binds the exact embedded
// manifest to the independently Source-selected AND Catalog-current public.
// It returns an id, never an artifact/resource approval or commissioning grant.
func (o *OriginalDeveloperSourceFactory) OriginalPublicationPublisherID(ctx context.Context, p Principal, signature []byte) (string, error) {
	if o == nil || ctx == nil || ctx.Err() != nil || !principalValid(p, time.Now().UnixMilli()) || len(signature) == 0 || len(signature) > 100000 {
		return "", ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.publisherUsable() {
		return "", ErrUnknown
	}
	v := o.publisher
	if v.publicationSelections == nil {
		v.publicationSelections = map[string]*originalFactoryPublicationSelection{}
	}
	binding := objectHash(p) + ":" + hash(signature)
	if previous := v.publicationSelections[binding]; previous != nil {
		if previous.principal != p || !bytes.Equal(previous.signature, signature) {
			return "", ErrConflict
		}
		if previous.result != nil {
			return "", previous.result
		}
		if e := o.recheckOriginalPublicationSelection(ctx, previous); e != nil {
			previous.result = ErrUnknown
			return "", ErrUnknown
		}
		return previous.key.PublisherID, nil
	}
	r := &originalFactoryPublicationSelection{principal: p, signature: append([]byte(nil), signature...), result: ErrUnknown}
	v.publicationSelections[binding] = r
	if e := o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		r.result = e
		return "", e
	}
	first, k, e := o.readOriginalSelectedPublisher(ctx, p)
	r.first = first
	r.key = k
	if e != nil {
		r.result = e
		return "", e
	}
	o.control.mu.Lock()
	if o.control.closeSelected || o.control.firstCause != nil {
		o.control.mu.Unlock()
		return "", ErrUnknown
	}
	r.mathematics, e = o.control.verifier.inspectOriginalSignedManifest(ctx, r.signature, r.key.PublicOriginal)
	o.control.mu.Unlock()
	if e != nil {
		r.result = e
		return "", e
	}
	m := r.mathematics
	if m == nil || m.account != p.Account || m.project != k.ProjectID || m.publisher != k.PublisherID || m.binding.ProjectID != k.ProjectID || m.owner != first.Owner {
		r.result = ErrDenied
		return "", ErrDenied
	}
	r.result = nil
	if e = o.recheckOriginalPublicationSelection(ctx, r); e != nil {
		r.result = ErrUnknown
		return "", ErrUnknown
	}
	return k.PublisherID, nil
}

var _ OriginalPublicationSelector = (*OriginalDeveloperSourceFactory)(nil)
