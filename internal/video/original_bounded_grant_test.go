//go:build ynx_canonical_media && ynx_media_combined_authority

package video

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"reflect"
	"testing"
	"time"
)

// MODEL ONLY: fixed publication/mapping/Node reply are not genuine admitted
// sources. Actual ORIGINAL product Store writes and cold readback are tested.
type ownedVideoBoundedTransport struct {
	model   *ownedVideoParticipantModel
	outside func(context.Context)
	failure error
}

func (t *ownedVideoBoundedTransport) AssertOriginalPreparedNodeTransportCurrent(context.Context) error {
	return nil
}
func (t *ownedVideoBoundedTransport) ReserveOriginalPreparedNode(c context.Context, op productsessionv2.OriginalEffectOperation) (productsessionv2.OriginalAdmission, error) {
	if t.outside != nil {
		t.outside(c)
	}
	a, e := t.model.AdmitOriginalUnknown(c, op)
	if t.failure != nil {
		return a, t.failure
	}
	return a, e
}

type ownedVideoBoundedPublication struct {
	op      productsessionv2.OriginalEffectOperation
	state   func(context.Context) string
	outside func(context.Context)
}

func (p *ownedVideoBoundedPublication) AssertOriginalPreparedPublicationCurrent(_ context.Context, op productsessionv2.OriginalEffectOperation) error {
	if !reflect.DeepEqual(op, p.op) {
		return errors.New("model association changed")
	}
	return nil
}
func (p *ownedVideoBoundedPublication) ReadOriginalPreparedPublication(c context.Context, id string) (productsessionv2.OriginalPreparedEffectPublication, error) {
	if p.outside != nil {
		p.outside(c)
	}
	if id != p.op.ID {
		return productsessionv2.OriginalPreparedEffectPublication{}, errors.New("model foreign ID")
	}
	return productsessionv2.OriginalPreparedEffectPublication{WorkID: id, State: p.state(c), Operation: p.op}, nil
}
func makeOwnedVideoBounded(t *testing.T) (*productsessionv2.OriginalEffectParticipant, *productsessionv2.OriginalBoundedPhaseReservation, *ownedVideoBoundedTransport, *ownedVideoBoundedPublication, VideoBusinessGrant) {
	t.Helper()
	first, c, m, a, now := makeOwnedVideoParticipant(t)
	original, e := first.OriginalOperation()
	if e != nil {
		t.Fatal(e)
	}
	transport := &ownedVideoBoundedTransport{model: m}
	r, e := productsessionv2.NewOriginalBoundedPhaseReservation(transport)
	if e != nil {
		t.Fatal(e)
	}
	res, e := r.Reservation(m)
	if e != nil {
		t.Fatal(e)
	}
	reader, e := productsessionv2.NewAuthenticatedOriginalReadback(m)
	if e != nil {
		t.Fatal(e)
	}
	body := []byte(`{"original":"product-wire"}`)
	p, e := productsessionv2.NewOriginalEffectParticipant(context.Background(), c, m.session, nil, a, original.ID, original.Method, original.Path, body, res, reader)
	if e != nil {
		t.Fatal(e)
	}
	op, e := p.OriginalOperation()
	if e != nil {
		t.Fatal(e)
	}
	pub := &ownedVideoBoundedPublication{op: op, state: func(context.Context) string { return "mapped" }}
	transport.outside = func(ctx context.Context) {
		if _, e := c.Capture(ctx, m.session, nil); e != nil {
			t.Fatal("transport ran under authority gate", e)
		}
	}
	pub.outside = func(ctx context.Context) {
		if _, e := c.Capture(ctx, m.session, nil); e != nil {
			t.Fatal("publication getter ran under authority gate", e)
		}
	}
	g := VideoBusinessGrant{Actor: m.session.Account, ProductID: "video", Scope: "video.profile", SessionBinding: a.SessionBinding, Nonce: a.Nonce, BodyDigest: a.BodyDigest, ExpiresAt: a.ExpiresAt, Revalidate: func(context.Context) error { return nil }, Current: func(context.Context) error { return nil }}
	g.SessionExpiresAt, _ = time.Parse(time.RFC3339Nano, m.session.ExpiresAt)
	_ = now
	return p, r, transport, pub, g
}

func TestVideoOriginalBoundedGrantFactoryFirstFollowAndOriginalReadback(t *testing.T) {
	p, r, transport, pub, g := makeOwnedVideoBounded(t)
	op, _ := p.OriginalOperation()
	issued, _ := time.Parse(time.RFC3339Nano, op.Session.IssuedAt)
	s, _ := fixture(t, func(c *Config) { c.Now = func() time.Time { return issued.Add(time.Second) } })
	pub.state = func(ctx context.Context) string {
		s.store.mu.RLock()
		defer s.store.mu.RUnlock()
		if _, ok := s.store.state.OriginalOperations[op.NodeOperationID]; ok {
			return "intent-admitted"
		}
		return "mapped"
	}
	outside := transport.outside
	transport.outside = func(ctx context.Context) {
		outside(ctx)
		if !s.store.mu.TryLock() {
			t.Fatal("Node under Store lock")
		}
		s.store.mu.Unlock()
	}
	g, err := PrepareOriginalVideoBoundedGrant(g, p, r, pub)
	if err != nil {
		t.Fatal(err)
	}
	sc := videoLease(t, s, context.Background(), g, false)
	for _, name := range []string{"original first phase", "original second phase", "original third phase"} {
		if _, err = sc.CreatePlaylist(g.Actor, name); err != nil {
			t.Fatal(err)
		}
	}
	if transport.model.calls != 1 || !g.RequireOperationAssociation || g.Operation == nil {
		t.Fatal("factory repeated reservation")
	}
	identity := s.store.state.OriginalOperations[op.NodeOperationID].Identity
	recovered, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	record, err := recovered.ReadOriginalBusinessOperation(context.Background(), identity)
	if err != nil || len(record.Steps) != 3 || record.Identity.Operation.OwnedOperationID != op.ID {
		t.Fatal(record, err)
	}
}
func TestVideoOriginalBoundedGrantFactoryUncertaintyClosesWholeOperation(t *testing.T) {
	for _, phase := range []string{"intent", "follow", "lost-ACK"} {
		t.Run(phase, func(t *testing.T) {
			p, r, transport, pub, g := makeOwnedVideoBounded(t)
			op, _ := p.OriginalOperation()
			issued, _ := time.Parse(time.RFC3339Nano, op.Session.IssuedAt)
			s, _ := fixture(t, func(c *Config) { c.Now = func() time.Time { return issued.Add(time.Second) } })
			pub.state = func(context.Context) string {
				if len(s.store.state.OriginalOperations) > 0 {
					return "intent-admitted"
				}
				return "mapped"
			}
			originalError := errors.New("controlled original commit uncertainty")
			if phase == "lost-ACK" {
				transport.failure = originalError
			}
			var err error
			g, err = PrepareOriginalVideoBoundedGrant(g, p, r, pub)
			if err != nil {
				t.Fatal(err)
			}
			sc := videoLease(t, s, context.Background(), g, false)
			if phase == "follow" {
				if _, err = sc.CreatePlaylist(g.Actor, "retained first phase"); err != nil {
					t.Fatal(err)
				}
			}
			err = sc.store.update(func(*State) error { return originalError })
			if err == nil || phase != "lost-ACK" && !errors.Is(err, originalError) {
				t.Fatal("original error lost", err)
			}
			if !transport.model.admitted || transport.model.calls != 1 {
				t.Fatal("original UNKNOWN lost")
			}
			if err = g.Current(context.Background()); !errors.Is(err, ErrVideoTransactionUnavailable) {
				t.Fatal("uncertain grant remained current", err)
			}
			if _, err = sc.CreatePlaylist(g.Actor, "no retry"); !errors.Is(err, ErrVideoTransactionUnavailable) || transport.model.calls != 1 {
				t.Fatal("factory reopened", err)
			}
			expected := 0
			if phase == "follow" {
				expected = 1
			}
			if len(s.store.state.Playlists) != expected {
				t.Fatal("original state changed after uncertainty")
			}
		})
	}
}
func TestVideoOriginalBoundedGrantFactoryMissingAndMismatchedSourcesClosed(t *testing.T) {
	p, r, _, pub, g := makeOwnedVideoBounded(t)
	if _, err := PrepareOriginalVideoBoundedGrant(g, p, r, nil); !errors.Is(err, ErrVideoTransactionUnavailable) {
		t.Fatal(err)
	}
	// A participant constructed with the unrelated original reservation cannot
	// be rebound to this factory's prepared Node response holder.
	foreign, _, _, _, _ := makeOwnedVideoParticipant(t)
	if _, err := PrepareOriginalVideoBoundedGrant(g, foreign, r, pub); err == nil {
		t.Fatal("foreign reservation accepted")
	}
}
