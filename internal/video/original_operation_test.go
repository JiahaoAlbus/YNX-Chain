package video

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"
)

func operationVideoGrant(s *Service) VideoBusinessGrant {
	g := videoTestGrant(s, "ynx1owner", "original_operation_nonce_001", nil)
	g.SessionBinding = strings.Repeat("b", 64)
	g.ProductID = "video"
	g.Scope = "video.write"
	g.Operation = &VideoOriginalOperationMetadata{OperationID: strings.Repeat("c", 64), SessionBinding: g.SessionBinding, NodeRequestDigest: strings.Repeat("f", 64), ActionBodyDigest: g.BodyDigest, Method: "POST", Path: "/api/playlists"}
	g.RequireOperationAssociation = true
	g.Current = func(context.Context) error { return nil }
	g.CaptureTransaction = func(context.Context) (VideoLocalTransaction, error) {
		return videoLocalTestTransaction(func(c context.Context, f func(context.Context) error) error { return f(c) }), nil
	}
	return g
}
func TestVideoOriginalOperationDurableDetachedAndCollision(t *testing.T) {
	s, _ := fixture(t, nil)
	g := operationVideoGrant(s)
	scoped := videoLease(t, s, context.Background(), g, false)
	original := *g.Operation
	g.Operation.OperationID = strings.Repeat("d", 64)
	p, err := scoped.CreatePlaylist(g.Actor, "original mapped playlist")
	if err != nil {
		t.Fatal(err)
	}
	n, err := s.ReadOriginalBusinessNonce(context.Background(), g.SessionBinding, g.Nonce)
	if err != nil || n.Operation == nil || *n.Operation != original || n.Operation.NodeRequestDigest == n.BodyDigest || n.Operation.ActionBodyDigest != n.BodyDigest {
		t.Fatal(n, err)
	}
	identity := VideoOriginalOperationIdentity{Operation: original, Actor: g.Actor, ProductID: g.ProductID, Scope: g.Scope, Nonce: g.Nonce, BodyDigest: g.BodyDigest, BusinessKey: videoBusinessNonceKey(g.SessionBinding, g.Nonce)}
	r, err := s.ReadOriginalBusinessOperation(context.Background(), identity)
	if err != nil || len(r.Steps) != 1 || r.Steps[0].ObjectID != p.ID {
		t.Fatal(r, err)
	}
	r.Steps[0].ObjectID = "foreign"
	n.Operation.OperationID = "foreign"
	recovered, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	r, err = recovered.ReadOriginalBusinessOperation(context.Background(), identity)
	if err != nil || r.Steps[0].ObjectID != p.ID {
		t.Fatal(r, err)
	}
	foreign := identity
	foreign.Actor = "ynx1foreign"
	if _, err = recovered.ReadOriginalBusinessOperation(context.Background(), foreign); !errors.Is(err, ErrUnauthorized) {
		t.Fatal(err)
	}
	// An expired replay marker may be collected, but the operation association
	// must still prevent executing the same ID with a fresh local lease.
	if err = recovered.store.update(func(st *State) error { delete(st.BusinessNonces, identity.BusinessKey); return nil }); err != nil {
		t.Fatal(err)
	}
	retry := operationVideoGrant(recovered)
	if _, err = videoLease(t, recovered, context.Background(), retry, false).CreatePlaylist(retry.Actor, "redispatch"); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("same operation repeated", err)
	}
	retry.Operation.OperationID = strings.Repeat("e", 64)
	retry.Nonce = "new_mapping_nonce_0001"
	retry.Operation = nil
	before := len(recovered.store.state.Playlists)
	sc := &Service{cfg: recovered.cfg, videoServiceControls: recovered.videoServiceControls, store: &Store{videoStateStore: recovered.store.videoStateStore, business: &videoBusinessLease{grant: retry, ctx: context.Background(), now: recovered.cfg.Now}}}
	if _, err = sc.CreatePlaylist(retry.Actor, "missing"); !errors.Is(err, ErrVideoTransactionUnavailable) || len(recovered.store.state.Playlists) != before {
		t.Fatal(err)
	}
}
func TestVideoOriginalOperationFailureNoAssociationAndLegacyUnavailable(t *testing.T) {
	s, _ := fixture(t, nil)
	g := operationVideoGrant(s)
	sc := videoLease(t, s, context.Background(), g, false)
	if err := sc.store.update(func(*State) error { return errors.New("controlled validation failure") }); err == nil || len(s.store.state.OriginalOperations) != 0 || len(s.store.state.BusinessNonces) != 0 {
		t.Fatal("failed write published association", err)
	}
	if _, err := s.ReadOriginalBusinessOperation(context.Background(), VideoOriginalOperationIdentity{Operation: *g.Operation}); !errors.Is(err, ErrVideoTransactionUnavailable) {
		t.Fatal(err)
	}
	old := videoTestGrant(s, g.Actor, "legacy_mapping_nonce_001", nil)
	if _, err := videoLease(t, s, context.Background(), old, false).CreatePlaylist(old.Actor, "legacy"); err != nil {
		t.Fatal(err)
	}
	n, err := s.ReadOriginalBusinessNonce(context.Background(), old.SessionBinding, old.Nonce)
	if err != nil || n.Operation != nil {
		t.Fatal("legacy metadata fabricated", n, err)
	}
	recovered, err := NewService(s.cfg)
	if err != nil || len(recovered.store.state.Playlists) != 1 {
		t.Fatal(err)
	}
}

func TestVideoOriginalOperationPublishedUncertaintyPreservesAssociation(t *testing.T) {
	s, _ := fixture(t, nil)
	before, err := os.ReadFile(s.store.statePath)
	if err != nil {
		t.Fatal(err)
	}
	g := operationVideoGrant(s)
	g.Current = func(context.Context) error {
		b, e := os.ReadFile(s.store.statePath)
		if e == nil && !bytes.Equal(b, before) {
			return ErrUnauthorized
		}
		return nil
	}
	sc := videoLease(t, s, context.Background(), g, false)
	if _, err = sc.CreatePlaylist(g.Actor, "published unknown"); !errors.Is(err, ErrVideoStatePublicationUnconfirmed) {
		t.Fatal(err)
	}
	recovered, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	identity := recovered.store.state.OriginalOperations[g.Operation.OperationID].Identity
	r, err := recovered.ReadOriginalBusinessOperation(context.Background(), identity)
	if err != nil || len(r.Steps) != 1 {
		t.Fatal(r, err)
	}
	// Reading matching bytes cannot turn the retained original uncertainty error
	// above into confirmed fsync/providerfinal or a permission to replay.
	if _, err = videoLease(t, recovered, context.Background(), operationVideoGrant(recovered), false).CreatePlaylist(g.Actor, "replay"); !errors.Is(err, ErrUnauthorized) {
		t.Fatal(err)
	}
}
