package oracle

import (
	"fmt"
	"testing"
	"time"
)

func scalarObservation(t *testing.T, source testReporter, sequence uint64, kind DataType, value, scale int64, at time.Time) Observation {
	t.Helper()
	observation := source.observation(t, sequence, 1, at)
	observation.ID = fmt.Sprintf("%s-%s-%d", source.provider.ID, kind, sequence)
	observation.Type = kind
	observation.Value = value
	observation.Scale = scale
	observation.Liquidity = 1_000_000
	observation.Volume24H = 10_000_000
	return source.signed(t, observation)
}

func ingestScalarSet(t *testing.T, service *Service, reporters []testReporter, sequence uint64, kind DataType, values []int64, scale int64, at time.Time) {
	t.Helper()
	if len(reporters) != len(values) {
		t.Fatal("reporter and value counts differ")
	}
	for index, source := range reporters {
		if _, err := service.Ingest(scalarObservation(t, source, sequence, kind, values[index], scale, at)); err != nil {
			t.Fatalf("ingest type=%s provider=%s: %v", kind, source.provider.ID, err)
		}
	}
}

func TestProviderCannotPublishDerivedPricesOrWrongMarket(t *testing.T) {
	now := time.Date(2026, 7, 25, 9, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	for index, kind := range []DataType{IndexPrice, MarkPrice, FundingReference} {
		observation := scalarObservation(t, source, uint64(index+1), kind, 1_000_000, 1_000_000, now)
		if err := observation.Verify(source.provider, "ynx-oracle-testnet-v1"); err == nil {
			t.Fatalf("provider-published derived type accepted: %s", kind)
		}
	}

	premium := scalarObservation(t, source, 4, PremiumReference, -250, 1_000_000, now)
	if err := premium.Verify(source.provider, "ynx-oracle-testnet-v1"); err != nil {
		t.Fatalf("signed negative premium rejected: %v", err)
	}
	depeg := scalarObservation(t, source, 5, StablecoinDepeg, 0, 1, now)
	if err := depeg.Verify(source.provider, "ynx-oracle-testnet-v1"); err != nil {
		t.Fatalf("boolean no-depeg status rejected: %v", err)
	}

	wrongMarket := scalarObservation(t, source, 6, SpotPrice, 1_000_000, 1_000_000, now)
	wrongMarket.Market = "ETH/EUR"
	wrongMarket = source.signed(t, wrongMarket)
	if err := wrongMarket.Verify(source.provider, "ynx-oracle-testnet-v1"); err == nil {
		t.Fatal("market outside provider registry coverage accepted")
	}

	wrongSource := scalarObservation(t, source, 7, SpotPrice, 1_000_000, 1_000_000, now)
	wrongSource.Source = "https://unregistered-source.invalid/v1"
	wrongSource = source.signed(t, wrongSource)
	if err := wrongSource.Verify(source.provider, "ynx-oracle-testnet-v1"); err == nil {
		t.Fatal("observation source outside provider registry accepted")
	}

	negativeLiquidity := scalarObservation(t, source, 8, PremiumReference, 100, 1_000_000, now)
	negativeLiquidity.Liquidity = -1
	negativeLiquidity = source.signed(t, negativeLiquidity)
	if err := negativeLiquidity.Verify(source.provider, "ynx-oracle-testnet-v1"); err == nil {
		t.Fatal("negative liquidity accepted")
	}
}

func TestServiceDerivesIndexFundingAndMarkWithExplicitLineage(t *testing.T) {
	now := time.Date(2026, 7, 25, 10, 0, 0, 0, time.UTC)
	reporters := []testReporter{
		reporter(t, "source-a", 1_000_000, now),
		reporter(t, "source-b", 1_000_000, now),
		reporter(t, "source-c", 1_000_000, now),
	}
	service := testService(t, &now, reporters...)
	observedAt := now.Add(-time.Second)
	ingestScalarSet(t, service, reporters, 1, SpotPrice, []int64{99_990_000, 100_000_000, 100_010_000}, 1_000_000, observedAt)
	ingestScalarSet(t, service, reporters, 2, PremiumReference, []int64{900, 1_000, 1_100}, 1_000_000, observedAt)
	ingestScalarSet(t, service, reporters, 3, BasisReference, []int64{-250, -200, -150}, 1_000_000, observedAt)

	index, err := service.Price("YNXT/YUSD_TEST", IndexPrice)
	if err != nil {
		t.Fatal(err)
	}
	if index.Value != 100_000_000 || index.Type != IndexPrice || index.Version != DerivativesPolicyVersion || index.Derivation == nil || index.Derivation.Method != "liquidity_weighted_median_spot_index" || index.Quality.SourceCount != 3 {
		t.Fatalf("index=%+v", index)
	}

	funding, err := service.Price("YNXT/YUSD_TEST", FundingReference)
	if err != nil {
		t.Fatal(err)
	}
	if funding.Value != 800 || funding.Scale != 1_000_000 || funding.Type != FundingReference || funding.Derivation == nil || funding.Derivation.PremiumPPM != 1_000 || funding.Derivation.BasisPPM != -200 || funding.Derivation.FundingWindowSeconds != int64((8*time.Hour)/time.Second) || funding.Derivation.Clamped {
		t.Fatalf("funding=%+v", funding)
	}

	mark, err := service.Price("YNXT/YUSD_TEST", MarkPrice)
	if err != nil {
		t.Fatal(err)
	}
	if mark.Value != 100_080_000 || mark.Type != MarkPrice || mark.Derivation == nil || mark.Derivation.AppliedAdjustmentPPM != 800 || mark.Derivation.Clamped || mark.Quality.Status != "good" || len(mark.ObservationIDs) != 9 || len(mark.LineageHash) != 64 {
		t.Fatalf("mark=%+v", mark)
	}

	now = now.Add(time.Second)
	repeated, err := service.Price("YNXT/YUSD_TEST", MarkPrice)
	if err != nil || repeated.LineageHash != mark.LineageHash || repeated.Value != mark.Value {
		t.Fatalf("same lineage was not idempotent: repeated=%+v err=%v", repeated, err)
	}

	state := service.store.Snapshot()
	found := map[DataType]bool{}
	for _, event := range state.AggregateEvents {
		if event.Price.Quality.Status == "good" {
			found[event.Price.Type] = true
		}
	}
	for _, kind := range []DataType{SpotPrice, PremiumReference, BasisReference, IndexPrice, FundingReference, MarkPrice} {
		if !found[kind] {
			t.Fatalf("missing durable good aggregate for %s", kind)
		}
	}
}

func TestFundingSpikeAndStaleMarkFailClosed(t *testing.T) {
	now := time.Date(2026, 7, 25, 11, 0, 0, 0, time.UTC)
	reporters := []testReporter{
		reporter(t, "source-a", 1_000_000, now),
		reporter(t, "source-b", 1_000_000, now),
		reporter(t, "source-c", 1_000_000, now),
	}
	service := testService(t, &now, reporters...)
	observedAt := now.Add(-time.Second)
	ingestScalarSet(t, service, reporters, 1, SpotPrice, []int64{99_990_000, 100_000_000, 100_010_000}, 1_000_000, observedAt)
	ingestScalarSet(t, service, reporters, 2, PremiumReference, []int64{5_900, 6_000, 6_100}, 1_000_000, observedAt)
	ingestScalarSet(t, service, reporters, 3, BasisReference, []int64{900, 1_000, 1_100}, 1_000_000, observedAt)

	funding, err := service.Price("YNXT/YUSD_TEST", FundingReference)
	if err == nil || funding.Quality.Status != "divergent" || !funding.Quality.CircuitBreaker || funding.Value != 5_000 || funding.Derivation == nil || !funding.Derivation.Clamped || funding.Derivation.RawAdjustmentPPM != 7_000 {
		t.Fatalf("funding spike accepted: funding=%+v err=%v", funding, err)
	}
	if mark, markErr := service.Price("YNXT/YUSD_TEST", MarkPrice); markErr == nil || !mark.Quality.CircuitBreaker {
		t.Fatalf("unsafe funding produced mark: mark=%+v err=%v", mark, markErr)
	}

	stableService := testService(t, &now, reporters...)
	ingestScalarSet(t, stableService, reporters, 1, SpotPrice, []int64{99_990_000, 100_000_000, 100_010_000}, 1_000_000, observedAt)
	ingestScalarSet(t, stableService, reporters, 2, PremiumReference, []int64{900, 1_000, 1_100}, 1_000_000, observedAt)
	ingestScalarSet(t, stableService, reporters, 3, BasisReference, []int64{-250, -200, -150}, 1_000_000, observedAt)
	good, err := stableService.Price("YNXT/YUSD_TEST", MarkPrice)
	if err != nil || good.Quality.Status != "good" {
		t.Fatalf("good mark unavailable: mark=%+v err=%v", good, err)
	}
	now = now.Add(time.Minute)
	stale, err := stableService.Price("YNXT/YUSD_TEST", MarkPrice)
	if err == nil || stale.Quality.Status != "last_good_stale" || !stale.Quality.Stale || !stale.Quality.CircuitBreaker || stale.Quality.SourceLimitation == "" {
		t.Fatalf("stale mark was not explicit: mark=%+v err=%v", stale, err)
	}
}
