package oracle

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"math"
	"testing"
	"time"
)

type testReporter struct {
	provider Provider
	private  ed25519.PrivateKey
}

func reporter(t *testing.T, id string, weight int64, now time.Time) testReporter {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	provider := Provider{
		ID: id, Name: "Test source " + id, Endpoint: "https://" + id + ".invalid.test/v1",
		APIVersion: "v1", AssetMarketCoverage: []string{"YNXT/YUSD_TEST"}, License: "test fixture only",
		TermsURL: "https://" + id + ".invalid.test/terms", PermittedStorage: "test fixture only",
		Authentication: "Ed25519 observation signatures", RateLimit: "100/s", TimestampSemantics: "venue event time",
		Precision: "1e-6", Timezone: "UTC", Region: "test", Jurisdiction: "test", Cost: "test fixture",
		Retention: "test lifetime", DataRights: "test fixture only", Fallback: "none; fail closed",
		DecommissionPlan: "remove through versioned policy", Status: "active", ReporterID: "reporter:" + id,
		ReporterPublicKeyHex: hex.EncodeToString(public), WeightPPM: weight, UpdatedAt: now,
	}
	if err := provider.Validate(); err != nil {
		t.Fatalf("provider: %v", err)
	}
	return testReporter{provider, private}
}

func (reporter testReporter) observation(t *testing.T, sequence uint64, value int64, at time.Time) Observation {
	t.Helper()
	observation := Observation{
		Schema: SchemaVersion, ID: reporter.provider.ID + "-observation", ProviderID: reporter.provider.ID,
		ReporterID: reporter.provider.ReporterID, Sequence: sequence, NonceDomain: "ynx-oracle-testnet-v1",
		Market: "YNXT/YUSD_TEST", Type: SpotPrice, Value: value, Scale: 1_000_000,
		Liquidity: 1_000_000, Volume24H: 10_000_000, ObservedAt: at, ReceivedAt: at.Add(time.Millisecond),
		Source: reporter.provider.Endpoint, SourceVersion: reporter.provider.APIVersion,
	}
	data, err := observation.signingBytes()
	if err != nil {
		t.Fatal(err)
	}
	observation.SignatureHex = hex.EncodeToString(ed25519.Sign(reporter.private, data))
	observation.Hash, err = observation.CalculatedHash()
	if err != nil {
		t.Fatal(err)
	}
	if err := observation.Verify(reporter.provider, "ynx-oracle-testnet-v1"); err != nil {
		t.Fatalf("signed observation: %v", err)
	}
	return observation
}

func TestAggregateRejectsOutlierAndReturnsLineage(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	reporters := []testReporter{reporter(t, "source-a", 1_000_000, now), reporter(t, "source-b", 1_000_000, now), reporter(t, "source-c", 1_000_000, now), reporter(t, "source-d", 1_000_000, now)}
	providers := map[string]Provider{}
	observations := []Observation{}
	values := []int64{1_000_000, 1_001_000, 999_000, 9_000_000}
	for index, item := range reporters {
		providers[item.provider.ID] = item.provider
		observations = append(observations, item.observation(t, 1, values[index], now.Add(-time.Second)))
	}
	price, err := Aggregate(now, observations, providers, DefaultPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if price.Value != 1_000_000 || price.Quality.SourceCount != 3 || len(price.Quality.RejectedSources) != 1 ||
		price.Quality.Stale || price.Quality.CircuitBreaker || len(price.LineageHash) != 64 || price.Source == "" || price.AsOf.IsZero() {
		t.Fatalf("unexpected aggregate: %+v", price)
	}
}

func TestAggregateFailsClosedForThinSourcesAndDivergence(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	a, b := reporter(t, "source-a", 1_000_000, now), reporter(t, "source-b", 1_000_000, now)
	providers := map[string]Provider{a.provider.ID: a.provider, b.provider.ID: b.provider}
	price, err := Aggregate(now, []Observation{a.observation(t, 1, 1_000_000, now), b.observation(t, 1, 1_001_000, now)}, providers, DefaultPolicy())
	if err == nil || !price.Quality.CircuitBreaker || price.Quality.Status != "circuit_breaker" || price.Quality.SourceLimitation == "" {
		t.Fatalf("thin market accepted: price=%+v err=%v", price, err)
	}

	c := reporter(t, "source-c", 1_000_000, now)
	providers[c.provider.ID] = c.provider
	policy := DefaultPolicy()
	policy.OutlierMADMultiple = 1_000
	price, err = Aggregate(now, []Observation{a.observation(t, 2, 1_000_000, now), b.observation(t, 2, 1_100_000, now), c.observation(t, 2, 1_200_000, now)}, providers, policy)
	if err == nil || !price.Quality.CircuitBreaker || price.Quality.DivergencePPM <= policy.MaximumDivergencePPM {
		t.Fatalf("divergent market accepted: price=%+v err=%v", price, err)
	}
}

func TestObservationRejectsTamperWrongDomainAndSignature(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	original := source.observation(t, 1, 1_000_000, now)

	tampered := original
	tampered.Value++
	if err := tampered.Verify(source.provider, "ynx-oracle-testnet-v1"); err == nil {
		t.Fatal("tampered value accepted")
	}
	if err := original.Verify(source.provider, "wrong-domain"); err == nil {
		t.Fatal("wrong nonce domain accepted")
	}
	other := reporter(t, "source-b", 1_000_000, now)
	wrongProvider := source.provider
	wrongProvider.ReporterPublicKeyHex = other.provider.ReporterPublicKeyHex
	if err := original.Verify(wrongProvider, "ynx-oracle-testnet-v1"); err == nil {
		t.Fatal("wrong signature accepted")
	}
}

func TestAggregateRejectsStaleAndFutureObservations(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	providers := map[string]Provider{source.provider.ID: source.provider}
	for _, at := range []time.Time{now.Add(-time.Minute), now.Add(3 * time.Second)} {
		price, err := Aggregate(now, []Observation{source.observation(t, 1, 1_000_000, at)}, providers, DefaultPolicy())
		if err == nil || !price.Quality.Stale || !price.Quality.CircuitBreaker {
			t.Fatalf("unsafe timestamp accepted: at=%s price=%+v err=%v", at, price, err)
		}
	}
}

func TestAggregateArithmeticCannotOverflowCircuitBreaker(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	reporters := []testReporter{reporter(t, "source-a", 1_000_000, now), reporter(t, "source-b", 1_000_000, now), reporter(t, "source-c", 1_000_000, now)}
	providers := map[string]Provider{}
	values := []int64{1, math.MaxInt64 - 1, math.MaxInt64}
	observations := make([]Observation, 0, len(reporters))
	for index, item := range reporters {
		providers[item.provider.ID] = item.provider
		observation := item.observation(t, 1, values[index], now)
		observation.Liquidity = math.MaxInt64
		data, _ := observation.signingBytes()
		observation.SignatureHex = hex.EncodeToString(ed25519.Sign(item.private, data))
		observation.Hash, _ = observation.CalculatedHash()
		observations = append(observations, observation)
	}
	policy := DefaultPolicy()
	policy.OutlierMADMultiple = math.MaxFloat64
	price, err := Aggregate(now, observations, providers, policy)
	if err == nil || !price.Quality.CircuitBreaker || price.Quality.DivergencePPM <= policy.MaximumDivergencePPM {
		t.Fatalf("overflow bypass: price=%+v err=%v", price, err)
	}
}
