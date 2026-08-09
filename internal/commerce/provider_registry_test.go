package commerce

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestProviderRegistryLifecycleIsStoreScopedRedactedAndDurable(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "commerce.json")
	store, err := Open(statePath)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 41)
	_, outsider := actor(t, 42)
	profile, _ := setupCatalog(t, store, owner, 2)

	configured, err := store.ConfigureProvider(owner, profile.ID, "shipping", ProviderConfigInput{
		Mode: "production", Endpoint: "https://shipping.example/v1", AccessRef: "vault://ynx/shop/shipping",
		Capabilities: []string{"tracking", "labels", "tracking"}, IdempotencyKey: "provider-config-0001",
	})
	if err != nil {
		t.Fatal(err)
	}
	if configured.HasAccessReference != true || configured.Health != providerHealthUntested || configured.Revision != 1 {
		t.Fatalf("unexpected provider view: %+v", configured)
	}
	if _, err := store.ProviderConfigs(outsider, profile.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("outsider read provider configs: %v", err)
	}

	request, err := store.BeginProviderTest(owner, profile.ID, "shipping")
	if err != nil {
		t.Fatal(err)
	}
	if request.AccessRef != "vault://ynx/shop/shipping" {
		t.Fatal("provider tester did not receive the opaque access reference")
	}
	healthy, err := store.CompleteProviderTest(request, ProviderTestResult{Status: providerHealthHealthy, Detail: "provider accepted the bounded probe"}, nil)
	if err != nil || healthy.Health != providerHealthHealthy || healthy.LastHealthyAt.IsZero() {
		t.Fatalf("healthy provider completion: %+v %v", healthy, err)
	}

	stale, err := store.BeginProviderTest(owner, profile.ID, "shipping")
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := store.RotateProviderReference(owner, profile.ID, "shipping", ProviderRotationInput{
		AccessRef: "kms://ynx/shop/shipping-v2", RotatedAt: time.Now().UTC(), IdempotencyKey: "provider-rotate-0001",
	})
	if err != nil || rotated.Health != providerHealthUntested || rotated.Revision != 2 {
		t.Fatalf("rotate provider: %+v %v", rotated, err)
	}
	if _, err := store.CompleteProviderTest(stale, ProviderTestResult{Status: providerHealthHealthy}, nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale provider test completion was accepted: %v", err)
	}

	exported, err := store.ExportSellerData(owner, profile.ID, "provider portability review")
	if err != nil || len(exported.Providers) != 1 || !exported.Providers[0].HasAccessReference {
		t.Fatalf("provider export: %+v %v", exported.Providers, err)
	}
	reloaded, err := Open(statePath)
	if err != nil {
		t.Fatal(err)
	}
	views, err := reloaded.ProviderConfigs(owner, profile.ID)
	if err != nil || len(views) != 1 || views[0].Revision != 2 {
		t.Fatalf("provider config did not survive restart: %+v %v", views, err)
	}
	if err := reloaded.ExportRollbackSnapshot(filepath.Join(t.TempDir(), "v6.json"), 6); !errors.Is(err, ErrConflict) {
		t.Fatalf("lossy v6 rollback was allowed: %v", err)
	}
	disabled, err := reloaded.DisableProvider(owner, profile.ID, "shipping", ProviderDisableInput{Reason: "provider contract ended", IdempotencyKey: "provider-disable-0001"})
	if err != nil || disabled.Mode != providerModeDisabled || disabled.HasAccessReference || disabled.Endpoint != "" {
		t.Fatalf("disable provider: %+v %v", disabled, err)
	}
}

func TestProviderRegistryRejectsUnsafeConfigurationAndRateLimitsTests(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "commerce.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 43)
	profile, _ := setupCatalog(t, store, owner, 1)
	for _, input := range []ProviderConfigInput{
		{Mode: "production", Endpoint: "http://shipping.example", AccessRef: "vault://ynx/shop/shipping", IdempotencyKey: "unsafe-provider-1"},
		{Mode: "production", Endpoint: "https://127.0.0.1", AccessRef: "vault://ynx/shop/shipping", IdempotencyKey: "unsafe-provider-2"},
		{Mode: "production", Endpoint: "https://shipping.example", AccessRef: "https://secret.example/key", IdempotencyKey: "unsafe-provider-3"},
	} {
		if _, err := store.ConfigureProvider(owner, profile.ID, "shipping", input); err == nil {
			t.Fatalf("unsafe provider configuration was accepted: %+v", input)
		}
	}
	if _, err := store.ConfigureProvider(owner, profile.ID, "shipping", ProviderConfigInput{Mode: "testnet", Endpoint: "https://shipping.example", AccessRef: "env://YNX_SHIPPING_KEY", IdempotencyKey: "safe-provider-1"}); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < providerTestLimit; attempt++ {
		if _, err := store.BeginProviderTest(owner, profile.ID, "shipping"); err != nil {
			t.Fatalf("provider test attempt %d: %v", attempt+1, err)
		}
	}
	if _, err := store.BeginProviderTest(owner, profile.ID, "shipping"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("provider test rate limit did not fail closed: %v", err)
	}
}
