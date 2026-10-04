//go:build ynx_canonical_media && ynx_media_combined_authority

package video

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"os"
	"strings"
	"testing"
	"time"
)

// Explicit software coordination MODEL, not installed mapper/reservation,
// genuine enrollment, proof or provider authentication. Actual owned Store
// persistence is exercised; these models supply no production permission.
type ownedVideoParticipantModel struct {
	session         productsessionv2.Session
	admitted        bool
	calls           int
	beforeAdmission func()
	stored          productsessionv2.OriginalEffectOperation
}

func (m *ownedVideoParticipantModel) AssertOriginalMediaSourceCurrent(context.Context) error {
	return nil
}
func (m *ownedVideoParticipantModel) ReadOriginalMediaAuthority(context.Context, productsessionv2.Session, *productsessionv2.BrowserGrant) (productsessionv2.MediaAuthoritySnapshot, error) {
	return productsessionv2.MediaAuthoritySnapshot{Session: m.session, FamilyID: "controlled-model-not-enrollment", Enrolled: true, GenerationAvailable: true, MembershipAvailable: true}, nil
}
func (m *ownedVideoParticipantModel) AssertOriginalNodeMappingCurrent(context.Context) error {
	return nil
}
func (m *ownedVideoParticipantModel) MapOriginalNodeOperation(_ context.Context, op productsessionv2.OriginalEffectOperation) (productsessionv2.OriginalEffectOperation, error) {
	op.NodeOperationID = strings.Repeat("a", 64)
	op.NodeRequestDigest = strings.Repeat("f", 64)
	return op, nil
}
func (m *ownedVideoParticipantModel) AssertOriginalReservationCurrent(context.Context) error {
	return nil
}
func (m *ownedVideoParticipantModel) AdmitOriginalUnknown(_ context.Context, op productsessionv2.OriginalEffectOperation) (productsessionv2.OriginalAdmission, error) {
	m.calls++
	if m.beforeAdmission != nil {
		m.beforeAdmission()
	}
	newly := !m.admitted
	m.admitted = true
	m.stored = op
	return productsessionv2.OriginalAdmission{Record: productsessionv2.OriginalOperationRecord{Operation: op, State: productsessionv2.OriginalOperationUnknown}, NewlyAdmitted: newly}, nil
}
func (m *ownedVideoParticipantModel) AssertAuthenticatedOriginalReadbackCurrent(context.Context) error {
	return nil
}
func (m *ownedVideoParticipantModel) ReadAuthenticatedOriginal(_ context.Context, op productsessionv2.OriginalEffectOperation) (productsessionv2.OriginalOperationRecord, error) {
	return productsessionv2.OriginalOperationRecord{Operation: op, State: productsessionv2.OriginalOperationUnknown}, nil
}
func makeOwnedVideoParticipant(t *testing.T) (*productsessionv2.OriginalEffectParticipant, *productsessionv2.MediaAuthorityCoordinator, *ownedVideoParticipantModel, productsessionv2.ActionAuthorization, time.Time) {
	t.Helper()
	b, e := os.ReadFile("../productsessionv2/testdata/finance-v2.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct{ Session productsessionv2.Session }
	if e = json.Unmarshal(b, &f); e != nil {
		t.Fatal(e)
	}
	// Derive a labelled native software model to exercise the actual product
	// tuple checks. No updated Session signature/approval/enrollment is claimed.
	f.Session.ProductID = "video"
	f.Session.ClientID = "ynx-video-v1"
	f.Session.Platform = "macos"
	f.Session.ApplicationID = "com.ynxweb4.video.macos"
	bundle := f.Session.ApplicationID
	f.Session.BundleID = &bundle
	f.Session.Origin = ""
	f.Session.Callback = "ynxvideo://wallet-auth/callback"
	f.Session.Scopes = []string{"video.profile"}
	binding := map[string]any{"chainId": f.Session.ChainID, "productId": f.Session.ProductID, "clientId": f.Session.ClientID, "platform": f.Session.Platform, "applicationId": f.Session.ApplicationID, "bundleId": f.Session.BundleID, "packageId": f.Session.PackageID, "origin": f.Session.Origin, "callback": f.Session.Callback, "account": f.Session.Account, "deviceId": f.Session.DeviceID, "deviceAlgorithm": f.Session.DeviceAlgorithm, "deviceKey": f.Session.DeviceKey}
	raw, _ := json.Marshal(binding)
	digest := sha256.Sum256(append([]byte("YNX_PRODUCT_SESSION_DEVICE_V2\n"), raw...))
	f.Session.DeviceBinding = hex.EncodeToString(digest[:])
	issued, _ := time.Parse(time.RFC3339Nano, f.Session.IssuedAt)
	now := issued.Add(time.Second)
	m := &ownedVideoParticipantModel{session: f.Session}
	c := productsessionv2.NewMediaAuthorityCoordinator(func() time.Time { return now })
	if _, e = c.RegisterOriginalWriter(context.Background(), m); e != nil {
		t.Fatal(e)
	}
	body := []byte(`{"original":"product-wire"}`)
	d := sha256.Sum256(body)
	action := productsessionv2.ActionAuthorization{Nonce: "original_participant_nonce001", SessionBinding: f.Session.SessionBinding, BodyDigest: hex.EncodeToString(d[:]), ExpiresAt: now.Add(30 * time.Second)}
	reservation, e := productsessionv2.NewOriginalNodeReservation(m, m)
	if e != nil {
		t.Fatal(e)
	}
	reader, e := productsessionv2.NewAuthenticatedOriginalReadback(m)
	if e != nil {
		t.Fatal(e)
	}
	p, e := productsessionv2.NewOriginalEffectParticipant(context.Background(), c, f.Session, nil, action, "owned-video-intent-001", "POST", "/api/profile", body, reservation, reader)
	if e != nil {
		t.Fatal(e)
	}
	return p, c, m, action, now
}

func TestVideoOriginalParticipantFirstAdmissionAndDurableMapping(t *testing.T) {
	p, c, m, a, now := makeOwnedVideoParticipant(t)
	s, _ := fixture(t, func(cfg *Config) { cfg.Now = func() time.Time { return now } })
	end, _ := time.Parse(time.RFC3339Nano, m.session.ExpiresAt)
	g := VideoBusinessGrant{Actor: m.session.Account, ProductID: "video", Scope: "video.profile", SessionBinding: a.SessionBinding, Nonce: a.Nonce, BodyDigest: a.BodyDigest, ExpiresAt: a.ExpiresAt, SessionExpiresAt: end, Revalidate: func(context.Context) error { return nil }, Current: func(context.Context) error { return nil }}
	tx, meta, err := PrepareOriginalVideoParticipant(g, p)
	if err != nil {
		t.Fatal(err)
	}
	if meta.OperationID == meta.OwnedOperationID || meta.NodeRequestDigest == meta.ActionBodyDigest {
		t.Fatal("distinct identities/commitments collapsed")
	}
	g.Operation = &meta
	g.RequireOperationAssociation = true
	captures := 0
	g.CaptureTransaction = func(ctx context.Context) (VideoLocalTransaction, error) {
		captures++
		if captures == 1 {
			return tx, nil
		}
		return c.Capture(ctx, m.session, nil)
	}
	m.beforeAdmission = func() {
		if len(s.store.state.BusinessNonces) != 0 {
			t.Fatal("Node UNKNOWN came after original product commit")
		}
	}
	scoped := videoLease(t, s, context.Background(), g, false)
	for _, name := range []string{"first original local phase", "second original local phase"} {
		if _, err = scoped.CreatePlaylist(g.Actor, name); err != nil {
			t.Fatal(err)
		}
	}
	if captures != 2 || m.calls != 1 {
		t.Fatal("first Node admission repeated", captures, m.calls)
	}
	i := s.store.state.OriginalOperations[meta.OperationID].Identity
	recovered, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	r, err := recovered.ReadOriginalBusinessOperation(context.Background(), i)
	if err != nil || r.Identity.Operation.OwnedOperationID != m.stored.ID || r.Identity.Operation.OperationID != m.stored.NodeOperationID || len(r.Steps) != 2 {
		t.Fatal(r, err)
	}
	foreign := g
	foreign.BodyDigest = strings.Repeat("e", 64)
	if _, _, err = PrepareOriginalVideoParticipant(foreign, p); !errors.Is(err, ErrUnauthorized) {
		t.Fatal(err)
	}
	if _, _, err = PrepareOriginalVideoParticipant(g, nil); !errors.Is(err, ErrVideoTransactionUnavailable) {
		t.Fatal(err)
	}
}
func TestVideoOriginalParticipantExistingUnknownCannotEnterStore(t *testing.T) {
	p, _, m, a, now := makeOwnedVideoParticipant(t)
	m.admitted = true
	s, _ := fixture(t, func(cfg *Config) { cfg.Now = func() time.Time { return now } })
	end, _ := time.Parse(time.RFC3339Nano, m.session.ExpiresAt)
	g := VideoBusinessGrant{Actor: m.session.Account, ProductID: "video", Scope: "video.profile", SessionBinding: a.SessionBinding, Nonce: a.Nonce, BodyDigest: a.BodyDigest, ExpiresAt: a.ExpiresAt, SessionExpiresAt: end, Revalidate: func(context.Context) error { return nil }, Current: func(context.Context) error { return nil }}
	tx, meta, err := PrepareOriginalVideoParticipant(g, p)
	if err != nil {
		t.Fatal(err)
	}
	g.Operation = &meta
	g.RequireOperationAssociation = true
	g.CaptureTransaction = func(context.Context) (VideoLocalTransaction, error) { return tx, nil }
	if _, err = videoLease(t, s, context.Background(), g, false).CreatePlaylist(g.Actor, "not redispatched"); !errors.Is(err, ErrVideoTransactionUnavailable) || len(s.store.state.BusinessNonces) != 0 || len(s.store.state.OriginalOperations) != 0 {
		t.Fatal(err)
	}
}
