package dex

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

var testSecret = bytes.Repeat([]byte{0x42}, 32)

func fixture(index uint64, kind string) Event {
	return Event{ID: fmt.Sprintf("event-abcdefghijkl-%d", index), ChainID: 6423, ContractVersion: "ynx-dex-cpmm-v1", BlockNumber: 100 + index, BlockHash: fmt.Sprintf("0x%064x", 100+index), TxHash: fmt.Sprintf("0x%064x", 200+index), LogIndex: index, Type: kind, Pool: "0x0000000000000000000000000000000000000011", Account: "ynx1abcdefghijklmnopqrstuv", Token0: "0x0000000000000000000000000000000000000001", Token1: "0x0000000000000000000000000000000000000002", Amount0: "100", Amount1: "200", LPAmount: "50", Fee0: "1", Fee1: "0", Reserve0: "10000", Reserve1: "20000", Timestamp: time.Now().Add(-time.Minute).UTC()}
}

func vaultFixture(index uint64) Event {
	return Event{ID: fmt.Sprintf("vault-action-abcdef-%d", index), ChainID: ChainID, ContractVersion: "ynx-strategy-vault-v1", BlockNumber: 200 + index, BlockHash: fmt.Sprintf("0x%064x", 300+index), TxHash: fmt.Sprintf("0x%064x", 400+index), LogIndex: index, Type: "vault-action", Timestamp: time.Now().Add(-time.Minute).UTC(), Vault: "0x00000000000000000000000000000000000000f2", NonceDomain: fmt.Sprintf("0x%064x", 500), ActionNonce: fmt.Sprintf("%d", index), Method: "swapExactInput", MethodSelector: functionSelector("swapExactInput(uint256,uint256,uint256,address[],uint256)"), BeforeValue: "10000", AfterValue: "9999"}
}

func fairFlowFixture(index uint64) FairFlowEvent {
	return FairFlowEvent{ID: fmt.Sprintf("fairflow-event-abcd-%d", index), ChainID: ChainID, ContractVersion: "ynx-fairflow-v1", FairFlow: "0x00000000000000000000000000000000000000f4", BlockNumber: 300 + index, BlockHash: fmt.Sprintf("0x%064x", 500+index), TransactionHash: fmt.Sprintf("0x%064x", 600+index), LogIndex: index, Type: "winner-finalized", BatchID: "3", Actor: "0x00000000000000000000000000000000000000a1", Details: map[string]string{"priceX96": "158456325028528675187087900672", "rebateBps": "100", "scoreToken0": "55", "routeHash": fmt.Sprintf("0x%064x", 700), "bestExecutionDigest": fmt.Sprintf("0x%064x", 701)}, AsOf: time.Now().Add(-time.Minute).UTC(), Source: "confirmed YNX Testnet EVM logs", Version: "ynx-fairflow-event-v1", Confidence: "confirmed-on-chain", Coverage: "Confirmed FairFlow event identity and stage-specific indexed/data fields", Failure: nil}
}

func lpProtectionFixture(index uint64) LPProtectionEvent {
	return LPProtectionEvent{ID: fmt.Sprintf("lp-protection-event-%d", index), ChainID: ChainID, ContractVersion: "ynx-lp-protection-v1", LPProtection: "0x00000000000000000000000000000000000000f5", Pool: "0x0000000000000000000000000000000000000011", TokenIn: "0x0000000000000000000000000000000000000001", BlockNumber: 400 + index, BlockHash: fmt.Sprintf("0x%064x", 700+index), TransactionHash: fmt.Sprintf("0x%064x", 800+index), LogIndex: index, Type: "assessed", Details: map[string]string{"amountIn": "10000", "totalFeeBps": "145", "baseFeeBps": "30", "volatilityFeeBps": "50", "depthFeeBps": "10", "divergenceFeeBps": "0", "toxicFlowFeeBps": "5", "jitFeeBps": "50", "depegBps": "0", "oracleAsOf": "1700000000", "oracleSourceHash": fmt.Sprintf("0x%064x", 900), "realizedFeeAmount": "145", "incentiveAmount": "0"}, AsOf: time.Now().Add(-time.Minute).UTC(), Source: "confirmed YNX Testnet EVM logs", Version: "ynx-lp-protection-event-v1", Confidence: "confirmed-on-chain", Coverage: "Confirmed LP protection pool and assessed fee components with Oracle evidence identity", Failure: nil}
}

func TestLPProtectionEventsPersistRejectSubstitutionAndRewind(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := OpenStore(path, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	event := lpProtectionFixture(1)
	if created, err := store.AppendLPProtection(event); err != nil || !created {
		t.Fatalf("append %v %v", created, err)
	}
	if len(store.Pools()) != 0 || len(store.FairFlowEvents("")) != 0 || store.Analytics().LPProtectionEvents != 1 {
		t.Fatal("LP protection polluted projections or analytics missing")
	}
	if events := store.LPProtectionEvents(event.LPProtection, event.Pool); len(events) != 1 || events[0].Details["incentiveAmount"] != "0" {
		t.Fatalf("events=%#v", events)
	}
	tampered := event
	tampered.Details = map[string]string{}
	if err := tampered.Validate(); err == nil {
		t.Fatal("LP protection detail substitution accepted")
	}
	conflict := event
	conflict.Details = map[string]string{}
	for key, value := range event.Details {
		conflict.Details[key] = value
	}
	conflict.Details["totalFeeBps"] = "146"
	if _, err := store.AppendLPProtection(conflict); err == nil {
		t.Fatal("conflicting LP protection replay accepted")
	}
	restarted, err := OpenStore(path, testSecret)
	if err != nil || len(restarted.LPProtectionEvents(event.LPProtection, event.Pool)) != 1 {
		t.Fatalf("restart %v", err)
	}
	if err := restarted.Rewind(event.BlockNumber); err != nil || len(restarted.LPProtectionEvents("", "")) != 0 {
		t.Fatalf("rewind %v", err)
	}
}

func TestFairFlowEventsPersistRejectSubstitutionAndRewind(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := OpenStore(path, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	event := fairFlowFixture(1)
	if created, err := store.AppendFairFlow(event); err != nil || !created {
		t.Fatalf("append %v %v", created, err)
	}
	if len(store.Pools()) != 0 || len(store.VaultActions(event.FairFlow)) != 0 {
		t.Fatal("FairFlow polluted pool or Vault projections")
	}
	if len(store.FairFlowEvents(event.FairFlow)) != 1 || store.Analytics().FairFlowEvents != 1 {
		t.Fatal("FairFlow projection missing")
	}
	tampered := event
	tampered.Details = map[string]string{}
	if err := tampered.Validate(); err == nil {
		t.Fatal("detail substitution accepted")
	}
	if _, err := store.AppendFairFlow(func() FairFlowEvent {
		value := event
		value.Details = map[string]string{"priceX96": "1", "rebateBps": "100", "scoreToken0": "55", "routeHash": fmt.Sprintf("0x%064x", 700), "bestExecutionDigest": fmt.Sprintf("0x%064x", 701)}
		return value
	}()); err == nil {
		t.Fatal("conflicting replay accepted")
	}
	restarted, err := OpenStore(path, testSecret)
	if err != nil || len(restarted.FairFlowEvents(event.FairFlow)) != 1 {
		t.Fatalf("restart %v", err)
	}
	if err := restarted.Rewind(event.BlockNumber); err != nil || len(restarted.FairFlowEvents(event.FairFlow)) != 0 {
		t.Fatalf("rewind %v", err)
	}
}

func TestVaultActionsPersistReconcileAndRewindWithoutPollutingPools(t *testing.T) {
	legacyJSON, _ := json.Marshal(fixture(1, "swap"))
	if bytes.Contains(legacyJSON, []byte(`"vault"`)) || bytes.Contains(legacyJSON, []byte(`"nonceDomain"`)) {
		t.Fatal("empty Vault fields changed legacy event serialization")
	}
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := OpenStore(path, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	action := vaultFixture(7)
	tamperedMethod := action
	tamperedMethod.MethodSelector = functionSelector("swapExactOutput(uint256,uint256,uint256,address[],uint256)")
	if err := tamperedMethod.Validate(); err == nil {
		t.Fatal("method/selector substitution accepted")
	}
	if created, err := store.Append(action); err != nil || !created {
		t.Fatalf("append %v %v", created, err)
	}
	if len(store.Pools()) != 0 || len(store.Positions(action.Vault)) != 0 || len(store.Fees()) != 0 {
		t.Fatal("vault action polluted pool projections")
	}
	actions := store.VaultActions(strings.ToUpper(action.Vault[:2]) + action.Vault[2:])
	if len(actions) != 1 || actions[0].ActionNonce != "7" || actions[0].Method != "swapExactInput" || actions[0].Failure != nil || actions[0].Confidence != "confirmed-on-chain" {
		t.Fatalf("actions=%#v", actions)
	}
	if store.Analytics().VaultActions != 1 {
		t.Fatal("vault analytics missing")
	}
	restarted, err := OpenStore(path, testSecret)
	if err != nil || len(restarted.VaultActions(action.Vault)) != 1 {
		t.Fatalf("restart %v", err)
	}
	if _, err := restarted.Append(func() Event { value := action; value.AfterValue = "1"; return value }()); err == nil {
		t.Fatal("conflicting vault replay accepted")
	}
	if err := restarted.Rewind(action.BlockNumber); err != nil || len(restarted.VaultActions(action.Vault)) != 0 {
		t.Fatalf("rewind %v", err)
	}
}

func TestStoreRestartReplayTamperAndConflict(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := OpenStore(path, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	event := fixture(1, "liquidity-add")
	created, err := store.Append(event)
	if err != nil || !created {
		t.Fatalf("append %v %v", created, err)
	}
	created, err = store.Append(event)
	if err != nil || created {
		t.Fatalf("idempotency %v %v", created, err)
	}
	if _, err = store.Append(func() Event { value := event; value.Amount0 = "999"; return value }()); err == nil {
		t.Fatal("conflicting replay accepted")
	}
	restarted, err := OpenStore(path, testSecret)
	if err != nil || len(restarted.Events()) != 1 {
		t.Fatalf("restart %v", err)
	}
	data, _ := os.ReadFile(path)
	data = bytes.Replace(data, []byte(`"reserve0": "10000"`), []byte(`"reserve0": "99999"`), 1)
	_ = os.WriteFile(path, data, 0o600)
	if _, err = OpenStore(path, testSecret); err == nil {
		t.Fatal("tampered store accepted")
	}
}

func TestStoreMigratesAuthenticatedSchemaV1AndPreservesRollback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	legacyStore := &Store{path: path, secret: append([]byte(nil), testSecret...)}
	payload := storePayload{SchemaVersion: 1, Sequence: 1, Events: []Event{fixture(1, "swap")}}
	legacy := storeEnvelope{Payload: payload, Integrity: legacyStore.integrity(payload)}
	data, _ := json.MarshalIndent(legacy, "", "  ")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := OpenStore(path, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.state.SchemaVersion != 5 || len(migrated.Events()) != 1 || len(migrated.FairFlowEvents("")) != 0 || len(migrated.LPProtectionEvents("", "")) != 0 {
		t.Fatalf("migrated=%#v", migrated.state)
	}
	backup, err := os.ReadFile(path + ".schema-v1.bak")
	if err != nil || !bytes.Equal(backup, data) {
		t.Fatalf("rollback backup %v", err)
	}
	info, err := os.Stat(path + ".schema-v1.bak")
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("rollback mode %v %v", info, err)
	}
	var current storeEnvelope
	currentData, _ := os.ReadFile(path)
	if err := decodeExact(currentData, &current); err != nil || current.Payload.SchemaVersion != 5 {
		t.Fatalf("current schema %v %#v", err, current.Payload)
	}
}

func TestStoreMigratesAuthenticatedSchemaV2AndPreservesRollback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	legacyStore := &Store{path: path, secret: append([]byte(nil), testSecret...)}
	payload := storePayload{SchemaVersion: 2, Sequence: 1, Events: []Event{vaultFixture(2)}}
	legacy := storeEnvelope{Payload: payload, Integrity: legacyStore.integrity(payload)}
	data, _ := json.MarshalIndent(legacy, "", "  ")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := OpenStore(path, testSecret)
	if err != nil || migrated.state.SchemaVersion != 5 {
		t.Fatalf("migration %v %#v", err, migrated)
	}
	backup, err := os.ReadFile(path + ".schema-v2.bak")
	if err != nil || !bytes.Equal(backup, data) {
		t.Fatalf("backup %v", err)
	}
	info, err := os.Stat(path + ".schema-v2.bak")
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v %v", info, err)
	}
}

func TestStoreMigratesAuthenticatedSchemaV3AndPreservesRollback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	legacyStore := &Store{path: path, secret: append([]byte(nil), testSecret...)}
	payload := storePayload{SchemaVersion: 3, Sequence: 1, Events: []Event{}, FairFlowEvents: []FairFlowEvent{fairFlowFixture(3)}}
	legacy := storeEnvelope{Payload: payload, Integrity: legacyStore.integrity(payload)}
	data, _ := json.MarshalIndent(legacy, "", "  ")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := OpenStore(path, testSecret)
	if err != nil || migrated.state.SchemaVersion != 5 || len(migrated.FairFlowEvents("")) != 1 || len(migrated.LPProtectionEvents("", "")) != 0 {
		t.Fatalf("migration %v %#v", err, migrated)
	}
	backup, err := os.ReadFile(path + ".schema-v3.bak")
	if err != nil || !bytes.Equal(backup, data) {
		t.Fatalf("backup %v", err)
	}
}

func TestStoreMigratesSchemaV4WithoutLosingLPProtectionOrStablePools(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	legacyStore := &Store{path: path, secret: append([]byte(nil), testSecret...)}
	stable := fixture(4, "swap")
	stable.ContractVersion = "ynx-stableswap-v1"
	payload := storePayload{SchemaVersion: 4, Sequence: 2, Events: []Event{stable}, FairFlowEvents: []FairFlowEvent{}, LPProtectionEvents: []LPProtectionEvent{lpProtectionFixture(4)}}
	legacy := storeEnvelope{Payload: payload, Integrity: legacyStore.integrity(payload)}
	data, _ := json.MarshalIndent(legacy, "", "  ")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := OpenStore(path, testSecret)
	if err != nil || migrated.state.SchemaVersion != 5 || len(migrated.LPProtectionEvents("", "")) != 1 {
		t.Fatalf("migration %v %#v", err, migrated)
	}
	pools := migrated.Pools()
	if len(pools) != 1 || pools[0].ContractVersion != "ynx-stableswap-v1" {
		t.Fatalf("stable pools=%#v", pools)
	}
	backup, err := os.ReadFile(path + ".schema-v4.bak")
	if err != nil || !bytes.Equal(backup, data) {
		t.Fatalf("backup %v", err)
	}
}

func TestConcurrentAppendIsAtomic(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for i := uint64(1); i <= 40; i++ {
		group.Add(1)
		go func(index uint64) {
			defer group.Done()
			if _, err := store.Append(fixture(index, "swap")); err != nil {
				t.Errorf("append %d: %v", index, err)
			}
		}(i)
	}
	group.Wait()
	if len(store.Events()) != 40 {
		t.Fatalf("events=%d", len(store.Events()))
	}
}

func TestEventWithoutReserveSnapshotPreservesLatestPoolReserves(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	syncEvent := fixture(1, "sync")
	if _, err := store.Append(syncEvent); err != nil {
		t.Fatal(err)
	}
	claim := fixture(2, "protocol-fee-claimed")
	claim.Reserve0, claim.Reserve1 = "", ""
	if _, err := store.Append(claim); err != nil {
		t.Fatal(err)
	}
	pools := store.Pools()
	if len(pools) != 1 || pools[0].Reserve0 != syncEvent.Reserve0 || pools[0].Reserve1 != syncEvent.Reserve1 {
		t.Fatalf("reserves overwritten: %#v", pools)
	}
}

func TestStorePricesFeesAndTWAPUseOnlyRawIndexedAmounts(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	first := fixture(1, "sync")
	first.Timestamp = time.Now().Add(-2 * time.Minute).UTC()
	first.Price0Cumulative, first.Price1Cumulative = "1000", "2000"
	second := fixture(2, "sync")
	second.Timestamp = first.Timestamp.Add(60 * time.Second)
	second.Price0Cumulative, second.Price1Cumulative = "7000", "5000"
	swap := fixture(3, "swap")
	swap.Timestamp = second.Timestamp.Add(time.Second)
	swap.Fee0, swap.Fee1 = "30", "0"
	claim := fixture(4, "protocol-fee-claimed")
	claim.Timestamp = swap.Timestamp.Add(time.Second)
	claim.Fee0, claim.Fee1, claim.Reserve0, claim.Reserve1 = "5", "0", "", ""
	for _, event := range []Event{first, second, swap, claim} {
		if _, err := store.Append(event); err != nil {
			t.Fatal(err)
		}
	}
	prices := store.SpotPrices()
	if len(prices) != 1 || prices[0].Price0Numerator != "20000" || prices[0].Price0Denominator != "10000" {
		t.Fatalf("prices=%#v", prices)
	}
	twaps := store.TWAPs()
	if len(twaps) != 1 || twaps[0].Price0AverageX112 != "100" || twaps[0].Price1AverageX112 != "50" || twaps[0].IntervalSeconds != 60 {
		t.Fatalf("twaps=%#v", twaps)
	}
	fees := store.Fees()
	if len(fees) != 1 || fees[0].SwapFee0 != "30" || fees[0].ClaimedFee0 != "5" {
		t.Fatalf("fees=%#v", fees)
	}
}

type allowSession struct{}

func (allowSession) Authorize(_ context.Context, binding, account string, scopes []string) error {
	if binding == strings.Repeat("a", 64) && len(scopes) == 2 {
		return nil
	}
	return errors.New("rejected")
}

func TestServerStrictSchemaAuthAndTruthfulSources(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	token := Token{ChainID: ChainID, Address: "0x0000000000000000000000000000000000000002", Symbol: "TWO", Name: "Test Token Two", Decimals: 18, Standard: "ERC-20", ReviewStatus: "owner-reviewed-testnet"}
	server, err := NewServer(store, buildinfo.Info{Commit: "abc123", Release: "test"}, strings.Repeat("k", 32), allowSession{}, token)
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	event := fixture(1, "liquidity-add")
	data, _ := json.Marshal(event)
	request := httptest.NewRequest(http.MethodPost, "/internal/v1/events", bytes.NewReader(data))
	request.Header.Set("X-YNX-DEX-Indexer-Key", strings.Repeat("k", 32))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("ingest %d %s", response.Code, response.Body.String())
	}
	vaultAction := vaultFixture(7)
	vaultData, _ := json.Marshal(vaultAction)
	request = httptest.NewRequest(http.MethodPost, "/internal/v1/events", bytes.NewReader(vaultData))
	request.Header.Set("X-YNX-DEX-Indexer-Key", strings.Repeat("k", 32))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("vault ingest %d %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/vault/actions?vault="+vaultAction.Vault+"&limit=25", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"confidence":"confirmed-on-chain"`) || !strings.Contains(response.Body.String(), `"failure":null`) || !strings.Contains(response.Body.String(), `"actionNonce":"7"`) {
		t.Fatalf("vault actions %d %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/vault/actions?vault=bad", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("bad vault query %d", response.Code)
	}
	fairEvent := fairFlowFixture(9)
	if _, err := store.AppendFairFlow(fairEvent); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/fairflow/events?fairFlow="+fairEvent.FairFlow+"&batchId=3&limit=25", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"type":"winner-finalized"`) || !strings.Contains(response.Body.String(), `"confidence":"confirmed-on-chain"`) || !strings.Contains(response.Body.String(), `"failure":null`) {
		t.Fatalf("FairFlow API %d %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/fairflow/events?fairFlow=bad", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("bad FairFlow query %d", response.Code)
	}
	protectionEvent := lpProtectionFixture(10)
	if _, err := store.AppendLPProtection(protectionEvent); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/lp-protection/events?lpProtection="+protectionEvent.LPProtection+"&pool="+protectionEvent.Pool+"&type=assessed&limit=25", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"realizedFeeAmount":"145"`) || !strings.Contains(response.Body.String(), `"incentiveAmount":"0"`) || !strings.Contains(response.Body.String(), `"version":"ynx-lp-protection-events-api-v1"`) {
		t.Fatalf("LP protection API %d %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/lp-protection/events?lpProtection=bad", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("bad LP protection query %d", response.Code)
	}
	bad := map[string]any{}
	_ = json.Unmarshal(data, &bad)
	bad["unknown"] = true
	data, _ = json.Marshal(bad)
	request = httptest.NewRequest(http.MethodPost, "/internal/v1/events", bytes.NewReader(data))
	request.Header.Set("X-YNX-DEX-Indexer-Key", strings.Repeat("k", 32))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unknown fields %d", response.Code)
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/account/positions", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("missing wallet session %d", response.Code)
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/account/positions", nil)
	request.Header.Set("X-YNX-Account", event.Account)
	request.Header.Set("X-YNX-Session-Binding", strings.Repeat("a", 64))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "netLpAmount") {
		t.Fatalf("positions %d %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/analytics", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if !strings.Contains(response.Body.String(), "YNX Testnet EVM events") {
		t.Fatal("analytics source is not explicit")
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/tokens", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"reviewStatus":"owner-reviewed-testnet"`) || !strings.Contains(response.Body.String(), `"mainnet":false`) {
		t.Fatalf("tokens %d %s", response.Code, response.Body.String())
	}
	for path, source := range map[string]string{"/v1/prices": "raw indexed reserve ratios", "/v1/twap": "cumulative-price deltas", "/v1/fees": "raw token fee amounts"} {
		request = httptest.NewRequest(http.MethodGet, path, nil)
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), source) {
			t.Fatalf("%s %d %s", path, response.Code, response.Body.String())
		}
	}
}

func TestServerRejectsUnreviewedAndDuplicateTokenMetadata(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	valid := Token{ChainID: ChainID, Address: "0x00000000000000000000000000000000000000ab", Symbol: "ONE", Name: "Test Token One", Decimals: 18, Standard: "ERC-20", ReviewStatus: "owner-reviewed-testnet"}
	invalid := valid
	invalid.ReviewStatus = "self-reported"
	if _, err := NewServer(store, buildinfo.Info{}, strings.Repeat("k", 32), nil, invalid); err == nil {
		t.Fatal("unreviewed token accepted")
	}
	duplicate := valid
	duplicate.Address = "0x00000000000000000000000000000000000000AB"
	if _, err := NewServer(store, buildinfo.Info{}, strings.Repeat("k", 32), nil, valid, duplicate); err == nil {
		t.Fatal("case-insensitive duplicate token accepted")
	}
}

func TestRemoteAuthorizerRequiresExactCentralBindingResponse(t *testing.T) {
	binding := strings.Repeat("A", 64)
	account := "ynx1abcdefghijklmnopqrstuv"
	scopes := []string{"account:read", "dex:positions:read"}
	var mode atomic.Value
	mode.Store("valid")
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["sessionBinding"] != binding || body["account"] != account {
			t.Error("request binding missing")
		}
		value := map[string]any{"authorized": true, "sessionBinding": binding, "account": account, "productClientId": "ynx-dex-web-v1", "bundleId": "com.ynxweb4.dex.web", "scopes": scopes, "expiresAt": time.Now().Add(time.Minute).UTC()}
		if mode.Load().(string) == "substitute" {
			value["bundleId"] = "com.ynxweb4.exchange.web"
		}
		if mode.Load().(string) == "unknown" {
			value["extra"] = true
		}
		writeJSON(response, http.StatusOK, value)
	}))
	defer upstream.Close()
	authorizer := RemoteAuthorizer{URL: upstream.URL}
	if err := authorizer.Authorize(context.Background(), binding, account, scopes); err != nil {
		t.Fatalf("valid binding rejected: %v", err)
	}
	for _, next := range []string{"substitute", "unknown"} {
		mode.Store(next)
		if err := authorizer.Authorize(context.Background(), binding, account, scopes); err == nil {
			t.Fatalf("%s response accepted", next)
		}
	}
}
