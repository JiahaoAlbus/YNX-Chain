package kernel

import (
	"bytes"
	"context"
	"encoding/json"
	"time"
)

// Independent role-UID Source qualification. Called only by the private normal
// registered custodian bridge; no exported register(raw4), fresh nonce, QA
// approval, caller-selected Root/profile or first-device family is involved.
// The received originals are untrusted constraints until the original verifier
// admits them. Resource/actual peer/binding/key membership remains independent.
func loadOriginalSocialJointProviderCapture(ctx context.Context, in socialJointCapturedPublicOriginals) (*originalSocialJointIssuerCapture, error) {
	profiles, e := approvedSourceBootstrapProfiles(ctx)
	if e != nil {
		return nil, e
	}
	if len(profiles) == 0 {
		return nil, errSourceRegistrationRequired
	}
	var registration sourceRegistration
	if decodeSourceCanonical(in.Registration, &registration, 65536) != nil || registration.Version != 1 {
		return nil, errSourceProofInvalid
	}
	issuer, v, e := loadSourceCredential(ctx, registration.Issuer, "issuer", profiles)
	if e != nil {
		return nil, e
	}
	anchor, av, e := loadSourceCredential(ctx, registration.Anchor, "anchor", profiles)
	if e != nil {
		return nil, e
	}
	if issuer.Scope != anchor.Scope || issuer.Authority == anchor.Authority || issuer.Custodian == anchor.Custodian || !sourcePublicComponentsDistinct(issuer.Public, anchor.Public) || v.image != av.image || !socialDeviceSessionPrincipalPolicySame(issuer.DeviceSessionPrincipal, anchor.DeviceSessionPrincipal) {
		return nil, errSourceRegistrationRequired
	}
	ir, e := json.Marshal(issuer)
	if e != nil || !bytes.Equal(ir, in.Issuer) {
		return nil, errSourceProofInvalid
	}
	ar, e := json.Marshal(anchor)
	if e != nil || !bytes.Equal(ar, in.Anchor) {
		return nil, errSourceProofInvalid
	}
	var envelope sourceEnvelope
	if decodeSourceCanonical(in.History, &envelope, sourceProofLimit) != nil {
		return nil, errSourceProofInvalid
	}
	raw, e := v.verifyEnvelope(ctx, envelope, "current-history", anchor.Public)
	if e != nil {
		return nil, e
	}
	var head sourceHistoryBody
	if decodeSourceCanonical(raw, &head, sourceProofLimit) != nil {
		return nil, errSourceProofInvalid
	}
	// Nonce is the SAME actually signed captured history nonce, NOT a new
	// provider challenge and not an account/device nonce. Signature already AND.
	if _, e = sourceBytes(head.Nonce, 32, 32); e != nil {
		return nil, e
	}
	now := time.Now()
	at := now.UnixMilli()
	if head.Version != 1 || head.Authority != anchor.Authority || head.Epoch != anchor.Epoch || head.Scope != anchor.Scope || !sourceDigestOK(head.Head) || !sourceDigestOK(head.CatalogDigest) || head.Records > 4096 || head.IssuedMS > at+5000 || head.IssuedMS < 0 || head.ExpiresMS <= at || head.ExpiresMS <= head.IssuedMS || head.ExpiresMS-head.IssuedMS > 30000 {
		return nil, errSourceHistoryRequired
	}
	origin := &signedAuthorityOrigin{registration: registration, issuer: issuer, anchor: anchor, history: head, historyEnvelope: envelope, verifier: v, deadline: now.Add(time.Duration(head.ExpiresMS-at) * time.Millisecond)}
	// Original actual catalog/checkpoint proof chain, not caller count/head or
	// an inferred empty genesis. Fetch is outside any custodian/key/journal lock.
	if e = fetchSourceCatalog(ctx, origin); e != nil {
		return nil, e
	}
	if !origin.current() {
		return nil, errSourceHistoryRequired
	}
	if e = origin.prepareDirectoryCheckpoint(ctx); e != nil {
		return nil, e
	}
	runtime := &SourceAuthorityRuntime{origin: origin}
	parent, e := runtime.retainPreparedOrigin(ctx, issuer.Scope)
	if e != nil {
		return nil, e
	}
	p := issuer.DeviceSessionPrincipal
	return captureOriginalSocialJointIssuerSource(ctx, parent, socialJointProfileResource{HeaderSHA256: p.HeaderSHA256, Realm: p.Realm, Client: p.Client, Network: p.Network})
}
