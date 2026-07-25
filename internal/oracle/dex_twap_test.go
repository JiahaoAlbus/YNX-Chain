package oracle

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const dexTestMarket = "YNXT/YUSD_TEST"

func dexTestReporters(t *testing.T, now time.Time) []testReporter {
	t.Helper()
	return []testReporter{
		reporter(t, "dex-source-a", 1_000_000, now),
		reporter(t, "dex-source-b", 1_000_000, now),
		reporter(t, "dex-source-c", 1_000_000, now),
	}
}

func dexTestPoolState(height uint64, blockTime time.Time, reserve0, reserve1 string) PoolState {
	return PoolState{
		ChainID:         "ynx-testnet-1",
		Pool:            "pool-ynxt-yusd-test",
		Token0:          "YNXT",
		Token1:          "YUSD_TEST",
		Token0Decimals:  18,
		Token1Decimals:  6,
		Reserve0:        reserve0,
		Reserve1:        reserve1,
		BlockNumber:     height,
		BlockHash:       fmt.Sprintf("%064x", height),
		ParentBlockHash: fmt.Sprintf("%064x", height-1),
		BlockTime:       blockTime.UTC(),
		Confirmations:   2,
	}
}

func dexTestObservation(t *testing.T, source testReporter, sequence uint64, state PoolState) Observation {
	t.Helper()
	observation := structuredBase(source, sequence, DEXPoolState, state.BlockTime)
	observation.PoolState = &state
	return source.signed(t, observation)
}

func dexWindowObservations(t *testing.T, reporters []testReporter, now time.Time, reserve0 string, reserve1ByHeight map[uint64]string) []Observation {
	t.Helper()
	observations := make([]Observation, 0, 18)
	for index := 0; index < 6; index++ {
		height := uint64(100 + index)
		blockTime := now.Add(time.Duration(index-5) * 12 * time.Second)
		reserve1 := "10000000000"
		if override, exists := reserve1ByHeight[height]; exists {
			reserve1 = override
		}
		for reporterIndex, source := range reporters {
			state := dexTestPoolState(height, blockTime, reserve0, reserve1)
			state.Confirmations = uint64(2 + reporterIndex)
			observations = append(observations, dexTestObservation(t, source, uint64(index+1), state))
		}
	}
	return observations
}

func dexProviderMap(reporters []testReporter) map[string]Provider {
	providers := make(map[string]Provider, len(reporters))
	for _, source := range reporters {
		providers[source.provider.ID] = source.provider
	}
	return providers
}

func ingestDEXObservations(t *testing.T, service *Service, observations []Observation) {
	t.Helper()
	for _, observation := range observations {
		if _, err := service.Ingest(observation); err != nil {
			t.Fatalf("ingest DEX block=%d provider=%s: %v", observation.PoolState.BlockNumber, observation.ProviderID, err)
		}
	}
}

func TestDEXTWAPDerivesConfirmedMultiBlockPriceAndReplay(t *testing.T) {
	now := time.Date(2026, 7, 25, 14, 0, 0, 0, time.UTC)
	reporters := dexTestReporters(t, now)
	service := testService(t, &now, reporters...)
	observations := dexWindowObservations(t, reporters, now, "100000000000000000000", nil)
	ingestDEXObservations(t, service, observations)

	price, err := service.Price(dexTestMarket, DEXTWAP)
	if err != nil {
		t.Fatal(err)
	}
	if price.Type != DEXTWAP || price.Value != 100_000_000 || price.Scale != 1_000_000 || price.Version != DEXTWAPPolicyVersion ||
		price.Quality.Status != "good" || price.Quality.SourceCount != 3 || price.Quality.RequiredSourceCount != 3 ||
		price.Quality.ConfidencePPM != 1_000_000 || price.Quality.CoveragePPM != 1_000_000 || price.Quality.SourceLimitation == "" ||
		len(price.ObservationIDs) != 18 || len(price.ObservationHash) != 18 || len(price.LineageHash) != 64 || price.Derivation == nil {
		t.Fatalf("DEX TWAP=%+v", price)
	}
	derivation := price.Derivation
	if derivation.Method != "confirmed_multi_block_guarded_twap" || derivation.PolicyVersion != DEXTWAPPolicyVersion ||
		len(derivation.ComponentTypes) != 1 || derivation.ComponentTypes[0] != DEXPoolState || derivation.ObservationWindowSeconds != 60 ||
		derivation.StartBlock != 100 || derivation.EndBlock != 105 || derivation.ConfirmationDepth != 2 || derivation.ChainID != "ynx-testnet-1" ||
		derivation.Pool != "pool-ynxt-yusd-test" || derivation.ObservationCount != 6 || derivation.ReporterCount != 3 ||
		len(derivation.RejectedBlockNumbers) != 0 || derivation.MinimumReserve0 != "100000000000000000000" || derivation.MinimumReserve1 != "10000000000" {
		t.Fatalf("DEX derivation=%+v", derivation)
	}

	replayed, err := service.DEXTWAPAt(dexTestMarket, now)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.Value != price.Value || replayed.LineageHash != price.LineageHash || replayed.AsOf != price.AsOf {
		t.Fatalf("historical replay mismatch live=%+v replay=%+v", price, replayed)
	}

	server, err := NewServer(service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		"/v1/dex/twap?market=" + dexTestMarket,
		"/v1/dex/twap/replay?market=" + dexTestMarket + "&asOf=" + now.Format(time.RFC3339Nano),
	} {
		response := httptest.NewRecorder()
		server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("path=%s status=%d body=%s", path, response.Code, response.Body.String())
		}
		var served Price
		if err := json.Unmarshal(response.Body.Bytes(), &served); err != nil {
			t.Fatal(err)
		}
		if served.Value != price.Value || served.LineageHash != price.LineageHash || served.Derivation == nil {
			t.Fatalf("path=%s price=%+v", path, served)
		}
	}

	versionResponse := httptest.NewRecorder()
	server.ServeHTTP(versionResponse, httptest.NewRequest(http.MethodGet, "/version", nil))
	if versionResponse.Code != http.StatusOK || !strings.Contains(versionResponse.Body.String(), `"dexTwapPolicyVersion":"dex-twap-v1"`) {
		t.Fatalf("version=%d %s", versionResponse.Code, versionResponse.Body.String())
	}
	health := service.PublicHealth()
	if health.DEXTWAPPolicyVersion != DEXTWAPPolicyVersion || health.Dependencies["dexTwapPolicy"] != DEXTWAPPolicyVersion {
		t.Fatalf("health=%+v", health)
	}

	now = now.Add(61 * time.Second)
	stale, staleErr := service.Price(dexTestMarket, DEXTWAP)
	if staleErr == nil || stale.Quality.Status != "last_good_stale" || !stale.Quality.Stale || !stale.Quality.CircuitBreaker || stale.Quality.SourceLimitation == "" {
		t.Fatalf("stale DEX TWAP was not explicit: price=%+v err=%v", stale, staleErr)
	}
}

func TestDEXTWAPGuardsOneFlashLoanBlock(t *testing.T) {
	now := time.Date(2026, 7, 25, 15, 0, 0, 0, time.UTC)
	reporters := dexTestReporters(t, now)
	observations := dexWindowObservations(t, reporters, now, "100000000000000000000", map[uint64]string{103: "50000000000"})
	price, err := deriveDEXTWAP(now, dexTestMarket, observations, dexProviderMap(reporters), DefaultDEXTWAPPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if price.Value != 100_000_000 || price.Quality.Status != "good" || price.Quality.ConfidencePPM != 900_000 ||
		price.Quality.DivergencePPM <= DefaultDEXTWAPPolicy().MaximumSingleBlockDeviationPPM || price.Derivation == nil ||
		len(price.Derivation.RejectedBlockNumbers) != 1 || price.Derivation.RejectedBlockNumbers[0] != 103 ||
		len(price.Quality.RejectedSources) != 1 || price.Quality.RejectedSources[0] != "dex-block:103" {
		t.Fatalf("flash-loan guard failed: %+v", price)
	}
}

func TestDEXTWAPRejectsLowLiquidityAndUnresolvedReorg(t *testing.T) {
	now := time.Date(2026, 7, 25, 16, 0, 0, 0, time.UTC)
	reporters := dexTestReporters(t, now)
	providers := dexProviderMap(reporters)

	lowLiquidity := dexWindowObservations(t, reporters, now, "5000000000000000000", nil)
	lowPrice, lowErr := deriveDEXTWAP(now, dexTestMarket, lowLiquidity, providers, DefaultDEXTWAPPolicy())
	if lowErr == nil || lowPrice.Quality.Status != "degraded" || lowPrice.Quality.Stale || !lowPrice.Quality.CircuitBreaker || !strings.Contains(lowPrice.Quality.Failure, "low-liquidity") {
		t.Fatalf("low liquidity accepted: price=%+v err=%v", lowPrice, lowErr)
	}

	reorg := dexWindowObservations(t, reporters, now, "100000000000000000000", nil)
	for index := range reorg {
		if reorg[index].PoolState.BlockNumber == 103 && reorg[index].ProviderID == reporters[2].provider.ID {
			state := *reorg[index].PoolState
			state.BlockHash = strings.Repeat("f", 64)
			reorg[index].PoolState = &state
			reorg[index] = reporters[2].signed(t, reorg[index])
			break
		}
	}
	reorgPrice, reorgErr := deriveDEXTWAP(now, dexTestMarket, reorg, providers, DefaultDEXTWAPPolicy())
	if reorgErr == nil || reorgPrice.Quality.Status != "divergent" || !reorgPrice.Quality.CircuitBreaker || !strings.Contains(reorgPrice.Quality.Failure, "competing block hashes") {
		t.Fatalf("unresolved reorg accepted: price=%+v err=%v", reorgPrice, reorgErr)
	}
}

func TestDEXPoolStoreRejectsWrongParentAndProviderPublishedTWAP(t *testing.T) {
	now := time.Date(2026, 7, 25, 17, 0, 0, 0, time.UTC)
	source := reporter(t, "dex-source-a", 1_000_000, now)
	service := testService(t, &now, source)
	firstState := dexTestPoolState(100, now.Add(-12*time.Second), "100000000000000000000", "10000000000")
	if _, err := service.Ingest(dexTestObservation(t, source, 1, firstState)); err != nil {
		t.Fatal(err)
	}
	wrongParent := dexTestPoolState(101, now, "100000000000000000000", "10000000000")
	wrongParent.ParentBlockHash = strings.Repeat("e", 64)
	if _, err := service.Ingest(dexTestObservation(t, source, 2, wrongParent)); err == nil || !strings.Contains(err.Error(), "parent hash conflict") {
		t.Fatalf("wrong parent accepted: %v", err)
	}

	providerTWAP := scalarObservation(t, source, 3, DEXTWAP, 100_000_000, 1_000_000, now)
	if err := providerTWAP.Verify(source.provider, "ynx-oracle-testnet-v1"); err == nil {
		t.Fatal("provider-published DEX TWAP accepted")
	}

	zeroReserve := dexTestPoolState(102, now, "00", "10000000000")
	zeroObservation := dexTestObservation(t, source, 4, zeroReserve)
	zeroObservation.ReceivedAt = now
	if err := zeroObservation.Verify(source.provider, "ynx-oracle-testnet-v1"); err == nil {
		t.Fatal("zero reserve with leading zeroes accepted")
	}
}
