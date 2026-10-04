//go:build ynx_canonical_media && ynx_media_combined_authority

package music

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
type ownedMusicBoundedTransport struct {
	model   *ownedMusicParticipantModel
	outside func(context.Context)
	failure error
}

func (t *ownedMusicBoundedTransport) AssertOriginalPreparedNodeTransportCurrent(context.Context) error {
	return nil
}
func (t *ownedMusicBoundedTransport) ReserveOriginalPreparedNode(c context.Context, op productsessionv2.OriginalEffectOperation) (productsessionv2.OriginalAdmission, error) {
	if t.outside != nil {
		t.outside(c)
	}
	a, e := t.model.AdmitOriginalUnknown(c, op)
	if t.failure != nil {
		return a, t.failure
	}
	return a, e
}

type ownedMusicBoundedPublication struct {
	op      productsessionv2.OriginalEffectOperation
	state   func(context.Context) string
	outside func(context.Context)
}

func (p *ownedMusicBoundedPublication) AssertOriginalPreparedPublicationCurrent(_ context.Context, op productsessionv2.OriginalEffectOperation) error {
	if !reflect.DeepEqual(op, p.op) {
		return errors.New("model association changed")
	}
	return nil
}
func (p *ownedMusicBoundedPublication) ReadOriginalPreparedPublication(c context.Context, id string) (productsessionv2.OriginalPreparedEffectPublication, error) {
	if p.outside != nil {
		p.outside(c)
	}
	if id != p.op.ID {
		return productsessionv2.OriginalPreparedEffectPublication{}, errors.New("model foreign ID")
	}
	return productsessionv2.OriginalPreparedEffectPublication{WorkID: id, State: p.state(c), Operation: p.op}, nil
}
func makeOwnedMusicBounded(t *testing.T) (*productsessionv2.OriginalEffectParticipant, *productsessionv2.OriginalBoundedPhaseReservation, *ownedMusicBoundedTransport, *ownedMusicBoundedPublication, MusicBusinessGrant) {
	t.Helper()
	first, c, m, a, now := makeOwnedMusicParticipant(t)
	original, e := first.OriginalOperation()
	if e != nil {
		t.Fatal(e)
	}
	transport := &ownedMusicBoundedTransport{model: m}
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
	pub := &ownedMusicBoundedPublication{op: op, state: func(context.Context) string { return "mapped" }}
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
	g := MusicBusinessGrant{Actor: m.session.Account, ProductID: "music", Scope: "music.profile", SessionBinding: a.SessionBinding, Nonce: a.Nonce, BodyDigest: a.BodyDigest, ExpiresAt: a.ExpiresAt, Revalidate: func(context.Context) error { return nil }, Current: func(context.Context) error { return nil }}

	_ = now
	return p, r, transport, pub, g
}

func TestMusicOriginalBoundedGrantFactoryFirstFollowAndOriginalReadback(t *testing.T) {
	p, r, transport, pub, g := makeOwnedMusicBounded(t)
	op, _ := p.OriginalOperation()
	issued, _ := time.Parse(time.RFC3339Nano, op.Session.IssuedAt)
	s := testService(t)
	s.cfg.Now = func() time.Time { return issued.Add(time.Second) }
	pub.state = func(ctx context.Context) string {
		s.mu.RLock()
		defer s.mu.RUnlock()
		if _, ok := s.state.OriginalOperations[op.NodeOperationID]; ok {
			return "intent-admitted"
		}
		return "mapped"
	}
	outside := transport.outside
	transport.outside = func(ctx context.Context) {
		outside(ctx)
		if !s.mu.TryLock() {
			t.Fatal("Node under Store lock")
		}
		s.mu.Unlock()
	}
	g, err := PrepareOriginalMusicBoundedGrant(g, p, r, pub)
	if err != nil {
		t.Fatal(err)
	}
	sc := s.requestService(&musicBusinessLease{ctx: context.Background(), grant: g})
	for _, name := range []string{"original first phase", "original second phase", "original third phase"} {
		if _, err = sc.UpsertProfile(g.Actor, Profile{DisplayName: name}); err != nil {
			t.Fatal(err)
		}
	}
	if transport.model.calls != 1 || !g.RequireOperationAssociation || g.Operation == nil {
		t.Fatal("factory repeated reservation")
	}
	identity := s.state.OriginalOperations[op.NodeOperationID].Identity
	recovered, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	record, err := recovered.ReadOriginalBusinessOperation(context.Background(), identity)
	if err != nil || len(record.Record.Steps) != 3 || record.Record.Identity.Operation.OwnedOperationID != op.ID {
		t.Fatal(record, err)
	}
}
func TestMusicOriginalBoundedGrantFactoryUncertaintyClosesWholeOperation(t *testing.T) {
	for _, phase := range []string{"intent", "follow", "lost-ACK"} {
		t.Run(phase, func(t *testing.T) {
			p, r, transport, pub, g := makeOwnedMusicBounded(t)
			op, _ := p.OriginalOperation()
			issued, _ := time.Parse(time.RFC3339Nano, op.Session.IssuedAt)
			s := testService(t)
			s.cfg.Now = func() time.Time { return issued.Add(time.Second) }
			pub.state = func(context.Context) string {
				if len(s.state.OriginalOperations) > 0 {
					return "intent-admitted"
				}
				return "mapped"
			}
			originalError := errors.New("controlled original commit uncertainty")
			if phase == "lost-ACK" {
				transport.failure = originalError
			}
			var err error
			g, err = PrepareOriginalMusicBoundedGrant(g, p, r, pub)
			if err != nil {
				t.Fatal(err)
			}
			sc := s.requestService(&musicBusinessLease{ctx: context.Background(), grant: g})
			if phase == "follow" {
				if _, err = sc.UpsertProfile(g.Actor, Profile{DisplayName: "retained first phase"}); err != nil {
					t.Fatal(err)
				}
			}
			err = sc.mutate(g.Actor, "controlled failed phase", g.Actor, nil, func(*persistentState) error { return originalError })
			if err == nil || phase != "lost-ACK" && !errors.Is(err, originalError) {
				t.Fatal("original error lost", err)
			}
			if !transport.model.admitted || transport.model.calls != 1 {
				t.Fatal("original UNKNOWN lost")
			}
			if err = g.Current(context.Background()); !errors.Is(err, ErrMusicAuthorityUnavailable) {
				t.Fatal("uncertain grant remained current", err)
			}
			if _, err = sc.UpsertProfile(g.Actor, Profile{DisplayName: "no retry"}); !errors.Is(err, ErrMusicAuthorityUnavailable) || transport.model.calls != 1 {
				t.Fatal("factory reopened", err)
			}
			expected := 0
			if phase == "follow" {
				expected = 1
			}
			if len(s.state.Profiles) != expected {
				t.Fatal("original state changed after uncertainty")
			}
		})
	}
}
func TestMusicOriginalBoundedGrantFactoryMissingAndMismatchedSourcesClosed(t *testing.T) {
	p, r, _, pub, g := makeOwnedMusicBounded(t)
	if _, err := PrepareOriginalMusicBoundedGrant(g, p, r, nil); !errors.Is(err, ErrMusicAuthorityUnavailable) {
		t.Fatal(err)
	}
	foreign, _, _, _, _ := makeOwnedMusicParticipant(t)
	if _, err := PrepareOriginalMusicBoundedGrant(g, foreign, r, pub); err == nil {
		t.Fatal("foreign reservation accepted")
	}
}
