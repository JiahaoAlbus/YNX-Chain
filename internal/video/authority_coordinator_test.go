//go:build ynx_canonical_media && ynx_media_combined_authority

package video

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"os"
	"sync/atomic"
	"testing"
	"time"
)

// Controlled enrollment labels only; this does NOT install a real writer/feed.
// Membership revision is read from the ORIGINAL durable channel, not epoch.
type videoOwnedCoordinatorSource struct {
	session        productsessionv2.Session
	channel, actor string
	view           atomic.Pointer[OriginalCreatorMembershipView]
}

func (s *videoOwnedCoordinatorSource) AssertOriginalMediaSourceCurrent(context.Context) error {
	return nil
}
func (s *videoOwnedCoordinatorSource) ReadOriginalMediaAuthority(context.Context, productsessionv2.Session, *productsessionv2.BrowserGrant) (productsessionv2.MediaAuthoritySnapshot, error) {
	v := s.view.Load()
	_, rev, ok := v.Lookup(s.channel, s.actor)
	return productsessionv2.MediaAuthoritySnapshot{Session: s.session, FamilyID: "controlled-integration-model-not-enrollment", PrivateGeneration: 0, GenerationAvailable: true, Enrolled: true, MembershipAvailable: ok, MembershipRevision: rev}, nil
}
func TestVideoOriginalCoordinatorDurableCommitAndMembershipInvalidation(t *testing.T) {
	b, err := os.ReadFile("../productsessionv2/testdata/finance-v2.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct{ Session productsessionv2.Session }
	if err = json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	issued, err := time.Parse(time.RFC3339Nano, f.Session.IssuedAt)
	if err != nil {
		t.Fatal(err)
	}
	now := issued.Add(time.Second)
	s, _ := fixture(t, func(cfg *Config) { cfg.Now = func() time.Time { return now } })
	ch, err := s.EnsureChannel(f.Session.Account, "coordinated", "Original owned channel")
	if err != nil {
		t.Fatal(err)
	}
	view, err := s.CopyOriginalCreatorMembership(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	source := &videoOwnedCoordinatorSource{session: f.Session, channel: ch.ID, actor: f.Session.Account}
	source.view.Store(&view)
	c := productsessionv2.NewMediaAuthorityCoordinator(func() time.Time { return now })
	writer, err := c.RegisterOriginalWriter(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	g := videoTestGrant(s, f.Session.Account, "coordinator_original_nonce_01", nil)
	g.Current = func(context.Context) error { return nil }
	g.CaptureTransaction = func(ctx context.Context) (VideoLocalTransaction, error) { return c.Capture(ctx, f.Session, nil) }
	scoped := videoLease(t, s, context.Background(), g, false)
	if _, err = scoped.CreatePlaylist(g.Actor, "durable original playlist"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadOriginalBusinessNonce(context.Background(), g.SessionBinding, g.Nonce); err != nil {
		t.Fatal(err)
	}
	pending, err := c.Capture(context.Background(), f.Session, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Real Store mutation/readback and immutable publication while writer owns gate.
	err = writer.Mutate(context.Background(), func(ctx context.Context) error {
		if err := s.store.update(func(st *State) error { bumpChannelAuthVersion(st.Channels[ch.ID]); return nil }); err != nil {
			return err
		}
		next, err := s.CopyOriginalCreatorMembership(ctx)
		if err == nil {
			source.view.Store(&next)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	ran := false
	if err = pending.Execute(context.Background(), func(context.Context) error { ran = true; return nil }); err == nil || ran {
		t.Fatal("old membership capture entered commit", err)
	}
	// Cancellation AFTER original publication cannot erase its nonce or permit replay.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	late := videoTestGrant(s, f.Session.Account, "coordinator_after_publish_01", nil)
	late.Current = func(context.Context) error { return nil }
	late.CaptureTransaction = func(capture context.Context) (VideoLocalTransaction, error) {
		e, err := c.Capture(capture, f.Session, nil)
		if err != nil {
			return nil, err
		}
		return videoLocalTestTransaction(func(run context.Context, commit func(context.Context) error) error {
			return e.Execute(run, func(local context.Context) error {
				err := commit(local)
				if err == nil {
					cancel()
				}
				return err
			})
		}), nil
	}
	_, err = videoLease(t, s, ctx, late, false).CreatePlaylist(late.Actor, "published before cancellation")
	var outcome *productsessionv2.MediaCoordinationError
	if !errors.As(err, &outcome) || !outcome.EffectStarted || outcome.Code != "EFFECT_OUTCOME_UNCONFIRMED" {
		t.Fatal("published uncertainty lost", err)
	}
	if _, err = s.ReadOriginalBusinessNonce(context.Background(), late.SessionBinding, late.Nonce); err != nil {
		t.Fatal("published nonce rolled back", err)
	}

	recovered, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = recovered.ReadOriginalBusinessNonce(context.Background(), g.SessionBinding, g.Nonce); err != nil {
		t.Fatal("original nonce missing after restart", err)
	}
}
