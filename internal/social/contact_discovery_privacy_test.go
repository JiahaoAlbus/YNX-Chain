package social

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

func TestContactDiscoverySourceSpecificPrivacy(t *testing.T) {
	s, _ := testService(t)
	profiles, err := square.New(square.Config{StatePath: filepath.Join(t.TempDir(), "square.json"), APIKey: "privacy-test-internal-key", Now: s.cfg.Now})
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.Square = profiles
	a, b := newFixture(t, 123), newFixture(t, 124)
	actor, target := Session{Account: a.account, DeviceID: "privacy-a"}, Session{Account: b.account, DeviceID: "privacy-b"}
	if _, _, err := s.UpdateContractProfile(target, "privacy-profile", "privacy_target", "Private Person", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SetSettings(target, ProfileSettingsInput{IdempotencyKey: "privacy-hidden", AllowRequestsFrom: "everyone"}); err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{"handle", "recommendation"} {
		if _, err := s.ResolveDiscovery(source, "privacy_target"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("hidden %s resolved: %v", source, err)
		}
		if _, err := s.PreviewContact(actor, testMultiResolver{"privacy_target": b.account}, source, "privacy_target"); err == nil {
			t.Fatalf("hidden %s preview exposed person", source)
		}
	}
	if _, _, err := s.SetSettings(target, ProfileSettingsInput{IdempotencyKey: "privacy-handle-only", DiscoverableByHandle: true, AllowRequestsFrom: "nobody"}); err != nil {
		t.Fatal(err)
	}
	if person, err := s.PreviewContact(actor, s, "handle", "privacy_target"); err != nil || person.ID != b.account {
		t.Fatalf("discoverable public profile wrongly hidden by request policy: %v", err)
	}
	if _, _, err := s.RequestContact(actor, ContactRequestInput{IdempotencyKey: "privacy-no-request", TargetAccount: b.account, Source: "handle"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("preview granted a disallowed friend request")
	}
	if _, err := s.ResolveDiscovery("recommendation", "privacy_target"); !errors.Is(err, ErrNotFound) {
		t.Fatal("handle visibility enabled recommendations")
	}
	if _, _, err := s.SetSettings(target, ProfileSettingsInput{IdempotencyKey: "privacy-recommendation-only", AllowRecommendations: true, AllowRequestsFrom: "everyone"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ResolveDiscovery("handle", "privacy_target"); !errors.Is(err, ErrNotFound) {
		t.Fatal("recommendation visibility enabled handle lookup")
	}
	if person, err := s.PreviewContact(actor, s, "recommendation", "privacy_target"); err != nil || person.ID != b.account {
		t.Fatal("explicit recommendation policy did not allow discovery")
	}
	_, token, err := s.CreateInvite(target, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if person, err := s.PreviewContact(actor, s, "invite", token); err != nil || person.ID != b.account {
		t.Fatal("valid invitation incorrectly used handle-index policy")
	}
	if _, err := s.ResolveDiscovery("handle", "missing_privacy_target"); !errors.Is(err, ErrNotFound) {
		t.Fatal("unknown profile must use same not-found outcome")
	}
}
