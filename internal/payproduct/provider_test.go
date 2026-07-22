package payproduct

import (
	"context"
	"strings"
	"testing"
	"time"
)

type fixedProviderProbe struct {
	result ProviderProbeResult
	err    error
}

func (p fixedProviderProbe) Probe(_ context.Context, _ ProviderDefinition, _ ProviderConnection) (ProviderProbeResult, error) {
	return p.result, p.err
}

func TestOfficialProviderCatalogIsCompleteAndVersioned(t *testing.T) {
	catalog := ProviderCatalog()
	categories := map[string]bool{}
	for _, provider := range catalog {
		categories[provider.Category] = true
		if provider.ID == "" || provider.DisplayName == "" || provider.Version == "" || provider.Source == "" || len(provider.Capabilities) == 0 || len(provider.Environments) == 0 {
			t.Fatalf("incomplete provider definition: %+v", provider)
		}
		if provider.Source == "official-provider-documentation" && (provider.DocumentationURL == "" || !strings.HasPrefix(provider.DocumentationURL, "https://")) {
			t.Fatalf("official provider lacks an HTTPS documentation source: %+v", provider)
		}
	}
	for _, category := range []string{"accounting", "shipping", "tax", "email", "object-storage", "stablecoin", "bridge", "pay", "trust"} {
		if !categories[category] {
			t.Fatalf("provider category %q is missing", category)
		}
	}
}

func TestProviderConnectionUsesServerSideProbeEvidence(t *testing.T) {
	now := time.Date(2026, 7, 22, 2, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	actor := MerchantPrincipal{Merchant: merchant, Account: merchant.PayoutAddress, Role: "owner"}
	if _, err := service.ConfigureProvider(actor, ProviderConnectionInput{ProviderID: "stripe", Environment: "sandbox", CredentialReference: "sk_test_secret", CredentialVersion: "v1"}); err == nil || !strings.Contains(err.Error(), "secrets are not accepted") {
		t.Fatalf("raw credential-shaped input was accepted: %v", err)
	}
	connection, err := service.ConfigureProvider(actor, ProviderConnectionInput{ProviderID: "stripe", Environment: "sandbox", CredentialReference: "credref_stripe_primary", CredentialVersion: "version-1"})
	if err != nil || connection.Status != "configured" || connection.Health != "unverified" {
		t.Fatalf("provider configuration failed: %+v %v", connection, err)
	}
	service.providerProbe = fixedProviderProbe{result: ProviderProbeResult{Health: "healthy", Source: "official-provider-api", Version: "stripe-account-v1", Coverage: "authentication-and-account-read"}}
	now = now.Add(time.Minute)
	verified, err := service.TestProvider(t.Context(), actor, connection.ID)
	if err != nil || verified.Status != "active" || verified.Health != "healthy" || verified.LastSuccessAt == nil || verified.HealthSource != "official-provider-api" {
		t.Fatalf("official probe evidence was not persisted: %+v %v", verified, err)
	}
	disabled, err := service.DisableProvider(actor, connection.ID)
	if err != nil || disabled.Status != "disabled" || disabled.Health != "disabled" {
		t.Fatalf("provider disable failed: %+v %v", disabled, err)
	}
	if _, err := service.TestProvider(t.Context(), actor, connection.ID); err == nil {
		t.Fatal("disabled provider connection was tested as active")
	}
}

func TestProviderProbeFailureIsVisibleAndFailsClosed(t *testing.T) {
	now := time.Date(2026, 7, 22, 3, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	actor := MerchantPrincipal{Merchant: merchant, Account: merchant.PayoutAddress, Role: "developer"}
	connection, err := service.ConfigureProvider(actor, ProviderConnectionInput{ProviderID: "circle-cctp", Environment: "sandbox", CredentialReference: "credref_circle_cctp", CredentialVersion: "version-1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TestProvider(t.Context(), actor, connection.ID); err == nil {
		t.Fatal("missing adapter was reported as a successful connection")
	}
	state, err := service.SnapshotForMerchant(merchant.ID)
	if err != nil {
		t.Fatal(err)
	}
	failed := state.Providers[connection.ID]
	if failed.Status != "unavailable" || failed.Health != "unavailable" || failed.LastFailureCode != "adapter_not_configured" || failed.LastCheckedAt == nil || failed.LastSuccessAt != nil {
		t.Fatalf("provider failure evidence is incomplete: %+v", failed)
	}
}

func TestSnapshotV1MigratesProvidersAndFutureVersionFails(t *testing.T) {
	path := t.TempDir() + "/state.json"
	store, err := OpenStore(path, bytes32(7))
	if err != nil {
		t.Fatal(err)
	}
	legacy := emptySnapshot()
	legacy.Version = 1
	legacy.Providers = nil
	if err := store.persist(legacy); err != nil {
		t.Fatal(err)
	}
	migrated, err := OpenStore(path, bytes32(7))
	if err != nil {
		t.Fatal(err)
	}
	if err := migrated.View(func(snapshot Snapshot) error {
		if snapshot.Version != SnapshotVersion || snapshot.Providers == nil {
			t.Fatalf("legacy snapshot was not migrated: %+v", snapshot)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	future := emptySnapshot()
	future.Version = SnapshotVersion + 1
	if err := store.persist(future); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenStore(path, bytes32(7)); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("future snapshot version was accepted: %v", err)
	}
}
