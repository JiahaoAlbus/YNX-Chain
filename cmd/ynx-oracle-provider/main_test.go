package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/oracle"
	"github.com/JiahaoAlbus/YNX-Chain/internal/oracle/providers"
)

func commandProvider(t *testing.T, status string) oracle.Provider {
	t.Helper()
	public, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	return oracle.Provider{
		ID: "coinbase-exchange", Name: "Coinbase Exchange",
		Endpoint: "https://api.exchange.coinbase.com/products/BTC-USD/ticker", APIVersion: "exchange-rest-v1",
		AssetMarketCoverage: []string{"BTC/USD"}, License: "approved", TermsURL: "https://www.coinbase.com/legal/market_data",
		PermittedStorage: "approved", Authentication: "public read plus reporter signature", RateLimit: "1/s",
		TimestampSemantics: "venue event time", Precision: "1e-6", Timezone: "UTC", Region: "test",
		Jurisdiction: "test", Cost: "test", Retention: "test", DataRights: "approved", Fallback: "fail closed",
		DecommissionPlan: "disable", Status: status, ReporterID: "reporter:coinbase-exchange",
		ReporterPublicKeyHex: hex.EncodeToString(public), WeightPPM: 1_000_000, UpdatedAt: now,
	}
}

func TestLoadProviderRequiresApprovedActiveRegistryEntry(t *testing.T) {
	for _, status := range []string{"active", "legal_approval_required"} {
		t.Run(status, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "providers.json")
			data, err := json.Marshal(registryFile{Schema: oracle.SchemaVersion, Providers: []oracle.Provider{commandProvider(t, status)}})
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, data, 0o600); err != nil {
				t.Fatal(err)
			}
			provider, err := loadProvider(path, "coinbase-exchange")
			if status == "active" {
				if err != nil || provider.ID != "coinbase-exchange" {
					t.Fatalf("active provider rejected: provider=%+v err=%v", provider, err)
				}
			} else if err == nil {
				t.Fatal("unapproved provider activated")
			}
		})
	}
}

func TestOfficialFetcherRejectsUnknownAdapter(t *testing.T) {
	adapter, err := providers.NewOfficialHTTP(nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := officialFetcher(adapter, "unknown", "BTC-USD", "BTC/USD", 1_000_000); err == nil {
		t.Fatal("unknown provider adapter accepted")
	}
}

func TestOfficialRegistryRouteMustMatchAdapter(t *testing.T) {
	provider := commandProvider(t, "active")
	route, err := providers.ResolveOfficialRoute("coinbase", "BTC-USD")
	if err != nil {
		t.Fatal(err)
	}
	if provider.ID != route.ProviderID || provider.Endpoint != route.Endpoint || provider.APIVersion != route.APIVersion {
		t.Fatalf("valid official registry route rejected: provider=%+v route=%+v", provider, route)
	}
	provider.Endpoint = "https://unregistered.invalid/ticker"
	if provider.ID == route.ProviderID && provider.Endpoint == route.Endpoint && provider.APIVersion == route.APIVersion {
		t.Fatal("mismatched official route accepted")
	}
}
