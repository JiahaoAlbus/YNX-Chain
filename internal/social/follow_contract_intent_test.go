package social

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

// Authority is synthetic software QA; all follow effects, notifications,
// idempotency and cold restart use the original local durable domain services.
func TestFollowIsIndependentAndNotificationIsNotDuplicated(t *testing.T) {
	f, peer := newFixture(t, 97), newFixture(t, 98)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.feed")
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.FollowTarget(actor, peer.account, "independent-follow", true)
	if err != nil || first.Replayed || !first.Record.Active {
		t.Fatalf("follow: %#v %v", first, err)
	}
	if len(s.state.Contacts) != 0 || len(s.state.Requests) != 0 {
		t.Fatal("following created a friendship/request")
	}
	following, err := s.cfg.Square.Following(actor.Account)
	if err != nil || len(following) != 1 || following[0] != peer.account {
		t.Fatal("actual following readback missing")
	}
	page, err := s.cfg.Square.Notifications(square.Device{Account: peer.account}, 100, "")
	if err != nil || len(page.Notifications) != 1 {
		t.Fatalf("original notification missing: %v", err)
	}
	if alerts, _ := s.Notifications(Session{Account: peer.account}); len(alerts) != 0 {
		t.Fatal("Social duplicated the Square notification")
	}
	path := filepath.Join(filepath.Dir(s.cfg.StatePath), "square.json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if retry, err := s.FollowTarget(actor, peer.account, "independent-follow", true); err != nil || !retry.Replayed {
		t.Fatalf("same-key retry: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("retry duplicated the Square effect/notification")
	}
	if _, err := s.FollowTarget(actor, peer.account, "explicit-unfollow", false); err != nil {
		t.Fatal(err)
	}
	if retry, err := s.FollowTarget(actor, peer.account, "independent-follow", true); err != nil || !retry.Replayed || retry.Record.Active {
		t.Fatalf("old receipt restored an unfollowed relationship: %v", err)
	}
	following, err = s.cfg.Square.Following(actor.Account)
	if err != nil || len(following) != 0 || len(s.state.Contacts) != 0 {
		t.Fatal("unfollow/retry changed independent friendship state")
	}
}

func TestFollowCancellationColdRetryKeepsOriginalIntentAndOneNotification(t *testing.T) {
	f, peer := newFixture(t, 99), newFixture(t, 100)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.feed")
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	actor.requestContext = ctx
	path := filepath.Join(filepath.Dir(s.cfg.StatePath), "square.json")
	localSquare, err := square.New(square.Config{StatePath: path, APIKey: "test-social-internal-key", Now: func() time.Time { cancel(); return time.Now().UTC() }})
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.Square = localSquare
	if _, err := s.FollowTarget(actor, peer.account, "original-follow-intent", true); !errors.Is(err, context.Canceled) {
		t.Fatalf("interrupted follow: %v", err)
	}
	key := idempotencyStateKey(actor.Account, "original-follow-intent")
	if s.state.Idempotency[key].Action != followContractPrepared {
		t.Fatal("unknown original intent was discarded/completed")
	}
	originalSquare, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	reopenedSquare, err := square.New(square.Config{StatePath: path, APIKey: "test-social-internal-key"})
	if err != nil {
		t.Fatal(err)
	}
	cfg := s.cfg
	cfg.Square = reopenedSquare
	reopened, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	fresh := reopened.state.Sessions["psv2:"+bridgeDigest(a.session.SessionBinding)]
	if _, err := reopened.FollowTarget(fresh, peer.account, "replacement-follow-key", false); !errors.Is(err, ErrConflict) {
		t.Fatalf("new key replaced unknown original operation: %v", err)
	}
	if _, err := reopened.FollowTarget(fresh, peer.account, "original-follow-intent", false); !errors.Is(err, ErrConflict) {
		t.Fatalf("original key changed request: %v", err)
	}
	result, err := reopened.FollowTarget(fresh, peer.account, "original-follow-intent", true)
	if err != nil || !result.Replayed || !result.Record.Active || reopened.state.Idempotency[key].Action != followContractCompleted {
		t.Fatalf("original cold retry failed: %#v %v", result, err)
	}
	afterSquare, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(originalSquare, afterSquare) {
		t.Fatal("cold retry repeated Square follow/notification")
	}
	page, err := reopenedSquare.Notifications(square.Device{Account: peer.account}, 100, "")
	if err != nil || len(page.Notifications) != 1 {
		t.Fatal("original notification duplicated or lost")
	}
	if alerts, _ := reopened.Notifications(Session{Account: peer.account}); len(alerts) != 0 {
		t.Fatal("recovery duplicated Social notification")
	}
}

func TestFollowRejectsStaleDeviceScopeBlockAndCancellationBeforeDispatch(t *testing.T) {
	for _, state := range []string{"revoked", "expired", "key-replaced", "missing-feed-scope", "blocked", "cancelled"} {
		t.Run(state, func(t *testing.T) {
			f, peer := newFixture(t, 101), newFixture(t, 102)
			a := &bridgeAuthority{session: bridgeSession(f, "android")}
			a.session.Scopes = append(a.session.Scopes, "social.contacts")
			if state != "missing-feed-scope" {
				a.session.Scopes = append(a.session.Scopes, "social.feed")
			}
			s := bridgeService(t, a, nil)
			actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
			if err != nil {
				t.Fatal(err)
			}
			expected := ErrUnauthorized
			switch state {
			case "revoked":
				if err := s.RevokeSession(actor); err != nil {
					t.Fatal(err)
				}
			case "expired":
				s.cfg.Now = func() time.Time { return actor.ExpiresAt }
			case "key-replaced":
				s.mu.Lock()
				device := s.state.Devices[actor.DeviceID]
				device.SigningPublicKey = "substituted-key"
				s.state.Devices[actor.DeviceID] = device
				s.mu.Unlock()
			case "blocked":
				if err := s.Block(actor, peer.account); err != nil {
					t.Fatal(err)
				}
			case "cancelled":
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				actor.requestContext = ctx
				expected = context.Canceled
			}
			path := filepath.Join(filepath.Dir(s.cfg.StatePath), "square.json")
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			originalState := objectDigest(s.state)
			if _, err := s.FollowTarget(actor, peer.account, "rejected-follow", true); !errors.Is(err, expected) {
				t.Fatalf("follow accepted %s: %v", state, err)
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) || originalState != objectDigest(s.state) {
				t.Fatal("rejected follow changed either store")
			}
		})
	}
}
