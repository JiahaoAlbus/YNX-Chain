package providers

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"net/http/httptest"

	"github.com/JiahaoAlbus/YNX-Chain/internal/oracle"
)

func runtimeProvider(t *testing.T, now time.Time) (oracle.Provider, ed25519.PrivateKey) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	provider := oracle.Provider{
		ID: "coinbase-exchange", Name: "Coinbase Exchange",
		Endpoint: "https://api.exchange.coinbase.com/products/BTC-USD/ticker", APIVersion: "exchange-rest-v1",
		AssetMarketCoverage: []string{"BTC/USD"}, License: "approved test fixture", TermsURL: "https://www.coinbase.com/legal/market_data",
		PermittedStorage: "approved test fixture", Authentication: "public read plus Ed25519 reporter",
		RateLimit: "1/s", TimestampSemantics: "venue event time", Precision: "1e-6", Timezone: "UTC",
		Region: "test", Jurisdiction: "test", Cost: "test", Retention: "test", DataRights: "approved test fixture",
		Fallback: "fail closed", DecommissionPlan: "disable registry entry", Status: "active",
		ReporterID: "reporter:coinbase-exchange", ReporterPublicKeyHex: hex.EncodeToString(public),
		WeightPPM: 1_000_000, UpdatedAt: now,
	}
	if err := provider.Validate(); err != nil {
		t.Fatal(err)
	}
	return provider, private
}

func TestSequenceStorePersistsStrictlyIncreasingValues(t *testing.T) {
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "sequence")
	state, err := OpenSequenceStore(path)
	if err != nil {
		t.Fatal(err)
	}
	first, err := state.Next(now)
	if err != nil {
		t.Fatal(err)
	}
	second, err := state.Next(now.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if second != first+1 {
		t.Fatalf("sequence did not survive clock rollback: first=%d second=%d", first, second)
	}
	reopened, err := OpenSequenceStore(path)
	if err != nil {
		t.Fatal(err)
	}
	third, err := reopened.Next(now)
	if err != nil || third != second+1 {
		t.Fatalf("sequence did not survive restart: second=%d third=%d err=%v", second, third, err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat sequence state: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("sequence permissions=%v", info.Mode().Perm())
	}
}

func TestSequenceStoreCoordinatesMultipleReporterProcesses(t *testing.T) {
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "sequence")
	first, err := OpenSequenceStore(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := OpenSequenceStore(path)
	if err != nil {
		t.Fatal(err)
	}
	results := make(chan uint64, 2)
	failures := make(chan error, 2)
	for _, state := range []*SequenceStore{first, second} {
		go func(current *SequenceStore) {
			value, err := current.Next(now)
			results <- value
			failures <- err
		}(state)
	}
	left, right := <-results, <-results
	if err := <-failures; err != nil {
		t.Fatal(err)
	}
	if err := <-failures; err != nil {
		t.Fatal(err)
	}
	if left == right || (left+1 != right && right+1 != left) {
		t.Fatalf("concurrent reporter sequences collide: left=%d right=%d", left, right)
	}
}

func TestReporterSignerRequiresOwnerOnlyMatchingKey(t *testing.T) {
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	provider, private := runtimeProvider(t, now)
	path := filepath.Join(t.TempDir(), "reporter.key")
	if err := os.WriteFile(path, []byte(hex.EncodeToString(private)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadReporterPrivateKey(path, provider)
	if err != nil || !loaded.Equal(private) {
		t.Fatalf("matching signer rejected: err=%v", err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadReporterPrivateKey(path, provider); err == nil {
		t.Fatal("group/world-readable signer accepted")
	}
}

func TestWorkerPublishesSignedOfficialCandidateEndToEnd(t *testing.T) {
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	provider, private := runtimeProvider(t, now)
	store, err := oracle.OpenStore(filepath.Join(t.TempDir(), "oracle-state.json"), []byte(strings.Repeat("k", 32)), "ynx-oracle-testnet-v1")
	if err != nil {
		t.Fatal(err)
	}
	service, err := oracle.NewService(store, []oracle.Provider{provider}, oracle.DefaultPolicy(), func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	server, err := oracle.NewServer(service, nil)
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	httpClient := httpServer.Client()
	httpClient.Timeout = time.Second
	publisher, err := NewPublisher(httpServer.URL, httpClient)
	if err != nil {
		t.Fatal(err)
	}
	sequences, err := OpenSequenceStore(filepath.Join(t.TempDir(), "sequence"))
	if err != nil {
		t.Fatal(err)
	}
	fetch := func(context.Context) (Candidate, error) {
		return Candidate{
			ProviderID: provider.ID, Market: "BTC/USD", Value: 67_500_123_456, Scale: 1_000_000,
			Volume24H: 1_200_500_000, ObservedAt: now.Add(-time.Second),
			Source: provider.Endpoint, SourceVersion: provider.APIVersion,
		}, nil
	}
	worker, err := NewWorker(fetch, provider, private, "ynx-oracle-testnet-v1", sequences, publisher, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := worker.RunOnce(context.Background())
	if err != nil || !receipt.Accepted || !receipt.Created {
		t.Fatalf("provider publish failed: receipt=%+v err=%v", receipt, err)
	}
	items, err := service.Replay("BTC/USD", oracle.SpotPrice, now)
	if err != nil || len(items) != 1 || items[0].Hash != receipt.Hash || items[0].ProviderID != provider.ID {
		t.Fatalf("published observation not durable: items=%+v err=%v", items, err)
	}
}

func TestWorkerRejectsInactiveMismatchedAndStaleCandidates(t *testing.T) {
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	provider, private := runtimeProvider(t, now)
	publisher, err := NewPublisher("http://127.0.0.1:6470", nil)
	if err != nil {
		t.Fatal(err)
	}
	sequences, err := OpenSequenceStore(filepath.Join(t.TempDir(), "sequence"))
	if err != nil {
		t.Fatal(err)
	}
	inactive := provider
	inactive.Status = "legal_approval_required"
	if _, err := NewWorker(func(context.Context) (Candidate, error) { return Candidate{}, nil }, inactive, private, "ynx-oracle-testnet-v1", sequences, publisher, func() time.Time { return now }); err == nil {
		t.Fatal("inactive provider worker started")
	}
	fetch := func(context.Context) (Candidate, error) {
		return Candidate{ProviderID: provider.ID, Market: "BTC/USD", Value: 1, Scale: 1,
			ObservedAt: now.Add(-time.Minute), Source: provider.Endpoint, SourceVersion: provider.APIVersion}, nil
	}
	worker, err := NewWorker(fetch, provider, private, "ynx-oracle-testnet-v1", sequences, publisher, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worker.RunOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("stale provider candidate accepted: %v", err)
	}
	mismatch := Candidate{ProviderID: provider.ID, Market: "BTC/USD", Value: 1, Scale: 1,
		ObservedAt: now, Source: "https://unregistered.invalid/ticker", SourceVersion: provider.APIVersion}
	if _, err := BuildObservation(mismatch, provider, private, "ynx-oracle-testnet-v1", 1, now); err == nil {
		t.Fatal("candidate outside registry endpoint accepted")
	}
}
