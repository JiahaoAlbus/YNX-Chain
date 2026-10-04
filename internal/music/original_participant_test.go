//go:build ynx_canonical_media && ynx_media_combined_authority

package music

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
type ownedMusicParticipantModel struct {
	session         productsessionv2.Session
	admitted        bool
	calls           int
	beforeAdmission func()
	stored          productsessionv2.OriginalEffectOperation
}

func (m *ownedMusicParticipantModel) AssertOriginalMediaSourceCurrent(context.Context) error {
	return nil
}
func (m *ownedMusicParticipantModel) ReadOriginalMediaAuthority(context.Context, productsessionv2.Session, *productsessionv2.BrowserGrant) (productsessionv2.MediaAuthoritySnapshot, error) {
	return productsessionv2.MediaAuthoritySnapshot{Session: m.session, FamilyID: "controlled-model-not-enrollment", Enrolled: true, GenerationAvailable: true, MembershipAvailable: true}, nil
}
func (m *ownedMusicParticipantModel) AssertOriginalNodeMappingCurrent(context.Context) error {
	return nil
}
func (m *ownedMusicParticipantModel) MapOriginalNodeOperation(_ context.Context, op productsessionv2.OriginalEffectOperation) (productsessionv2.OriginalEffectOperation, error) {
	op.NodeOperationID = strings.Repeat("a", 64)
	op.NodeRequestDigest = strings.Repeat("f", 64)
	return op, nil
}
func (m *ownedMusicParticipantModel) AssertOriginalReservationCurrent(context.Context) error {
	return nil
}
func (m *ownedMusicParticipantModel) AdmitOriginalUnknown(_ context.Context, op productsessionv2.OriginalEffectOperation) (productsessionv2.OriginalAdmission, error) {
	m.calls++
	if m.beforeAdmission != nil {
		m.beforeAdmission()
	}
	newly := !m.admitted
	m.admitted = true
	m.stored = op
	return productsessionv2.OriginalAdmission{Record: productsessionv2.OriginalOperationRecord{Operation: op, State: productsessionv2.OriginalOperationUnknown}, NewlyAdmitted: newly}, nil
}
func (m *ownedMusicParticipantModel) AssertAuthenticatedOriginalReadbackCurrent(context.Context) error {
	return nil
}
func (m *ownedMusicParticipantModel) ReadAuthenticatedOriginal(_ context.Context, op productsessionv2.OriginalEffectOperation) (productsessionv2.OriginalOperationRecord, error) {
	return productsessionv2.OriginalOperationRecord{Operation: op, State: productsessionv2.OriginalOperationUnknown}, nil
}
func makeOwnedMusicParticipant(t *testing.T) (*productsessionv2.OriginalEffectParticipant, *productsessionv2.MediaAuthorityCoordinator, *ownedMusicParticipantModel, productsessionv2.ActionAuthorization, time.Time) {
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
	f.Session.ProductID = "music"
	f.Session.ClientID = "ynx-music-v1"
	f.Session.Platform = "macos"
	f.Session.ApplicationID = "com.ynxweb4.music.macos"
	bundle := f.Session.ApplicationID
	f.Session.BundleID = &bundle
	f.Session.Origin = ""
	f.Session.Callback = "ynxmusic://wallet-auth/callback"
	f.Session.Scopes = []string{"music.profile"}
	binding := map[string]any{"chainId": f.Session.ChainID, "productId": f.Session.ProductID, "clientId": f.Session.ClientID, "platform": f.Session.Platform, "applicationId": f.Session.ApplicationID, "bundleId": f.Session.BundleID, "packageId": f.Session.PackageID, "origin": f.Session.Origin, "callback": f.Session.Callback, "account": f.Session.Account, "deviceId": f.Session.DeviceID, "deviceAlgorithm": f.Session.DeviceAlgorithm, "deviceKey": f.Session.DeviceKey}
	raw, _ := json.Marshal(binding)
	digest := sha256.Sum256(append([]byte("YNX_PRODUCT_SESSION_DEVICE_V2\n"), raw...))
	f.Session.DeviceBinding = hex.EncodeToString(digest[:])
	issued, _ := time.Parse(time.RFC3339Nano, f.Session.IssuedAt)
	now := issued.Add(time.Second)
	m := &ownedMusicParticipantModel{session: f.Session}
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
	p, e := productsessionv2.NewOriginalEffectParticipant(context.Background(), c, f.Session, nil, action, "owned-music-intent-001", "POST", "/api/profile", body, reservation, reader)
	if e != nil {
		t.Fatal(e)
	}
	return p, c, m, action, now
}

func TestMusicOriginalParticipantFirstAdmissionAndDurableMapping(t *testing.T) {
	p, c, m, a, now := makeOwnedMusicParticipant(t)
	s := testService(t)
	s.cfg.Now = func() time.Time { return now }
	g := MusicBusinessGrant{Actor: m.session.Account, ProductID: "music", Scope: "music.profile", SessionBinding: a.SessionBinding, Nonce: a.Nonce, BodyDigest: a.BodyDigest, ExpiresAt: a.ExpiresAt, Revalidate: func(context.Context) error { return nil }, Current: func(context.Context) error { return nil }}
	tx, meta, err := PrepareOriginalMusicParticipant(g, p)
	if err != nil {
		t.Fatal(err)
	}
	if meta.OperationID == meta.OwnedOperationID || meta.NodeRequestDigest == meta.ActionBodyDigest {
		t.Fatal("distinct identities/commitments collapsed")
	}
	g.Operation = &meta
	g.RequireOperationAssociation = true
	captures := 0
	g.CaptureTransaction = func(ctx context.Context) (MusicLocalTransaction, error) {
		captures++
		if captures == 1 {
			return tx, nil
		}
		return c.Capture(ctx, m.session, nil)
	}
	m.beforeAdmission = func() {
		if len(s.state.BusinessNonces) != 0 {
			t.Fatal("Node UNKNOWN came after original product commit")
		}
	}
	scoped := s.requestService(&musicBusinessLease{ctx: context.Background(), grant: g})
	for _, name := range []string{"first original local phase", "second original local phase"} {
		if _, err = scoped.UpsertProfile(g.Actor, Profile{DisplayName: name}); err != nil {
			t.Fatal(err)
		}
	}
	if captures != 2 || m.calls != 1 {
		t.Fatal("first Node admission repeated", captures, m.calls)
	}
	i := s.state.OriginalOperations[meta.OperationID].Identity
	recovered, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	r, err := recovered.ReadOriginalBusinessOperation(context.Background(), i)
	if err != nil || r.Record.Identity.Operation.OwnedOperationID != m.stored.ID || r.Record.Identity.Operation.OperationID != m.stored.NodeOperationID || len(r.Record.Steps) != 2 {
		t.Fatal(r, err)
	}
	foreign := g
	foreign.Nonce = "changed_original_nonce01"
	if _, _, err = PrepareOriginalMusicParticipant(foreign, p); !errors.Is(err, ErrUnauthorized) {
		t.Fatal(err)
	}
	if _, _, err = PrepareOriginalMusicParticipant(g, nil); !errors.Is(err, ErrMusicAuthorityUnavailable) {
		t.Fatal(err)
	}
}
func TestMusicOriginalParticipantExistingUnknownCannotEnterStore(t *testing.T) {
	p, _, m, a, now := makeOwnedMusicParticipant(t)
	m.admitted = true
	s := testService(t)
	s.cfg.Now = func() time.Time { return now }
	g := MusicBusinessGrant{Actor: m.session.Account, ProductID: "music", Scope: "music.profile", SessionBinding: a.SessionBinding, Nonce: a.Nonce, BodyDigest: a.BodyDigest, ExpiresAt: a.ExpiresAt, Revalidate: func(context.Context) error { return nil }, Current: func(context.Context) error { return nil }}
	tx, meta, err := PrepareOriginalMusicParticipant(g, p)
	if err != nil {
		t.Fatal(err)
	}
	g.Operation = &meta
	g.RequireOperationAssociation = true
	g.CaptureTransaction = func(context.Context) (MusicLocalTransaction, error) { return tx, nil }
	if _, err = s.requestService(&musicBusinessLease{ctx: context.Background(), grant: g}).UpsertProfile(g.Actor, Profile{DisplayName: "not redispatched"}); !errors.Is(err, ErrMusicAuthorityUnavailable) || len(s.state.BusinessNonces) != 0 || len(s.state.OriginalOperations) != 0 {
		t.Fatal(err)
	}
}
