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

// Software authority fixtures only; original local stores and disk recovery.
func TestProfileCrossStoreCancellationRetainsOriginalIntentAndColdRetry(t *testing.T) {
	f := newFixture(t, 93)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
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
	_, _, err = s.UpdateContractProfile(actor, "original-profile-intent", "historical_user", "Original Person", "Original bio", "https://example.test/avatar.png")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("interrupted second-store commit: %v", err)
	}
	key := idempotencyStateKey(actor.Account, "original-profile-intent")
	if s.state.Idempotency[key].Action != profileContractPrepared {
		t.Fatal("unknown cross-store intent was erased or declared completed")
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
	freshActor := reopened.state.Sessions["psv2:"+bridgeDigest(a.session.SessionBinding)]
	if freshActor.requestContext != nil {
		t.Fatal("cancelled request context persisted")
	}
	if _, _, err := reopened.UpdateContractProfile(freshActor, "replacement-key", "overwrite_user", "Wrong Person", "", ""); !errors.Is(err, ErrConflict) {
		t.Fatalf("new key replaced unknown original intent: %v", err)
	}
	if _, _, err := reopened.UpdateContractProfile(freshActor, "original-profile-intent", "changed_user", "Changed Person", "", ""); !errors.Is(err, ErrConflict) {
		t.Fatalf("original key body changed: %v", err)
	}
	view, replay, err := reopened.UpdateContractProfile(freshActor, "original-profile-intent", "historical_user", "Original Person", "Original bio", "https://example.test/avatar.png")
	if err != nil || !replay || view.Handle != "historical_user" || view.Privacy.AvatarURL != "https://example.test/avatar.png" {
		t.Fatalf("cold original retry failed: %#v %v", view, err)
	}
	if reopened.state.Idempotency[key].Action != profileContractCompleted {
		t.Fatal("original intent did not settle")
	}
	afterSquare, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(originalSquare, afterSquare) {
		t.Fatal("cold retry repeated or changed the original Square effect")
	}
}

func TestProfileCrossStoreRejectsStaleActorAndInvalidAvatarBeforeSquareEffect(t *testing.T) {
	f := newFixture(t, 94)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(filepath.Dir(s.cfg.StatePath), "square.json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.UpdateContractProfile(actor, "invalid-avatar", "safe_user", "Safe Person", "", "http://example.test/avatar"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid avatar: %v", err)
	}
	if err := s.RevokeSession(actor); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.UpdateContractProfile(actor, "revoked-profile", "safe_user", "Safe Person", "", ""); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("stale actor dispatched Square: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("invalid/stale request changed Square")
	}
}

func TestDefinitiveInvalidProfileSettlesWithoutBlockingCorrectedNewIntent(t *testing.T) {
	f := newFixture(t, 95)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.UpdateContractProfile(actor, "invalid-profile-body", "safe_user", "", "", ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid profile accepted: %v", err)
	}
	if s.state.Idempotency[idempotencyStateKey(actor.Account, "invalid-profile-body")].Action != profileContractRejected {
		t.Fatal("definitive no-effect failure left an unknown intent")
	}
	if _, _, err := s.UpdateContractProfile(actor, "corrected-new-intent", "safe_user", "Safe Person", "", ""); err != nil {
		t.Fatal(err)
	}
}

func TestProfileAvatarCommitPreservesPrivacyChangedAfterSquareEffect(t *testing.T) {
	f := newFixture(t, 96)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	request := square.SetProfileRequest{IdempotencyKey: "interleaved-profile", Handle: "privacy_user", DisplayName: "Privacy Person"}
	avatar := "https://example.test/avatar.png"
	if err := s.prepareProfileContract(actor, request, avatar); err != nil {
		t.Fatal(err)
	}
	if _, err := s.dispatchProfileContract(actor, request, avatar); err != nil {
		t.Fatal(err)
	}
	privacy := ProfileSettingsInput{IdempotencyKey: "newer-privacy", DiscoverableByHandle: false, ContactsMatching: true, AllowRecommendations: false, AllowRequestsFrom: "nobody"}
	if _, _, err := s.SetSettings(actor, privacy); err != nil {
		t.Fatal(err)
	}
	if err := s.setProfileContractAvatar(actor, request.IdempotencyKey, avatar); err != nil {
		t.Fatal(err)
	}
	if err := s.completeProfileContract(actor, request, avatar); err != nil {
		t.Fatal(err)
	}
	current := s.currentSettings(actor.Account)
	if current.DiscoverableByHandle || !current.ContactsMatching || current.AllowRecommendations || current.AllowRequestsFrom != "nobody" || current.AvatarURL != avatar {
		t.Fatal("profile merge replaced newer privacy state")
	}
}
