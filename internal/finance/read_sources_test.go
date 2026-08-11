package finance

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

func TestReadSourcesStayPendingWithoutOwnerContracts(t *testing.T) {
	upstreams := &Upstreams{}
	observedAt := time.Date(2026, 7, 27, 14, 0, 0, 0, time.UTC)
	sources := upstreams.ReadSources(observedAt)
	if len(sources) != 4 {
		t.Fatalf("read-source registry contains %d sources, want 4", len(sources))
	}
	for _, id := range []string{"exchange", "dex", "quant", "economics"} {
		source, ok := sources[id]
		if !ok {
			t.Fatalf("read-source %s is missing", id)
		}
		wantAccepted := id == "exchange" || id == "dex" || id == "quant"
		wantStatus := "owner-contract-pending"
		if wantAccepted {
			wantStatus = "integration-unconfigured"
		}
		if source.OwnerContractAccepted != wantAccepted || !source.ReadOnly || source.Status.Available || source.Status.SyncStatus != wantStatus || source.Status.AsOf == nil || !source.Status.AsOf.Equal(observedAt) {
			t.Fatalf("read-source %s does not fail closed: %+v", id, source)
		}
		if source.Action.Configured || source.Action.URL != "" || !source.Action.OpensOwnerProduct || !source.Action.RequiresOwnerApproval {
			t.Fatalf("read-source %s invented an action link: %+v", id, source.Action)
		}
		if len(source.ForbiddenCapabilities) == 0 {
			t.Fatalf("read-source %s lacks mutation boundaries", id)
		}
	}

	if err := upstreams.ConfigureReadSourceActions(ReadSourceActionConfig{ExchangeURL: "https://exchange.ynx.example/account"}); err != nil {
		t.Fatal(err)
	}
	sources = upstreams.ReadSources(observedAt)
	if !sources["exchange"].Action.Configured || sources["exchange"].Action.URL != "https://exchange.ynx.example/account" {
		t.Fatalf("reviewed Exchange action was not exposed: %+v", sources["exchange"].Action)
	}
	if sources["dex"].Action.Configured {
		t.Fatal("an unconfigured DEX action became available")
	}
	for _, invalid := range []string{"http://exchange.ynx.example", "javascript:alert(1)", "https://user:pass@exchange.ynx.example"} {
		if err := upstreams.ConfigureReadSourceActions(ReadSourceActionConfig{ExchangeURL: invalid}); err == nil {
			t.Fatalf("unsafe action URL %q was accepted", invalid)
		}
	}
}

func TestExchangeReadSourceLoadsBoundAccountEvidence(t *testing.T) {
	now := time.Date(2026, 8, 11, 9, 30, 0, 0, time.UTC)
	secret := strings.Repeat("x", 32)
	verifier, err := readintegration.NewVerifier(secret, "finance", "exchange", func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		account, verifyErr := verifier.Verify(r, "/v1/integrations/finance/account")
		if verifyErr != nil {
			http.Error(w, verifyErr.Error(), http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(ReadSourceEnvelope{
			EnvelopeVersion: ReadSourceEnvelopeVersion, SourceID: "exchange", Owner: "07-exchange",
			Network: ChainID, NativeAsset: "YNXT", AuthorizedAccount: account,
			OwnerContractVersion: "exchange-finance-read-v1", PayloadSchema: "ynx-exchange-finance-account-v1",
			AsOf: now, AsOfKind: "exchange-state-observed-at", Coverage: "authorized account state",
			SyncStatus: "authoritative-persisted-exchange-state", ReadOnly: true,
			Capabilities: append([]string(nil), acceptedReadSourceContracts["exchange"].AllowedCapabilities...),
			Payload:      json.RawMessage(`{"balances":[{"asset":"YNXT","availableMicro":9000000}]}`),
		})
	}))
	defer owner.Close()
	upstreams := &Upstreams{client: owner.Client()}
	if err := upstreams.ConfigureReadSourceIntegrations(ReadSourceIntegrationConfig{ExchangeURL: owner.URL, ExchangeKey: secret}); err != nil {
		t.Fatal(err)
	}
	sources := upstreams.ReadSourcesForAccount(context.Background(), testAccount, now)
	exchange := sources["exchange"]
	if !exchange.OwnerContractAccepted || !exchange.Status.Available || exchange.Envelope == nil || exchange.Envelope.AuthorizedAccount != testAccount || !strings.Contains(string(exchange.Envelope.Payload), `"availableMicro":9000000`) {
		t.Fatalf("Exchange evidence was not accepted: %+v", exchange)
	}
	if exchange.Status.Version != "exchange-finance-read-v1" || exchange.Status.SyncStatus != "authoritative-persisted-exchange-state" {
		t.Fatalf("Exchange provenance is incomplete: %+v", exchange.Status)
	}
}

func TestQuantReadSourceLoadsBoundStrategyAndExecutionEvidence(t *testing.T) {
	now := time.Date(2026, 8, 11, 9, 35, 0, 0, time.UTC)
	secret := strings.Repeat("q", 32)
	verifier, err := readintegration.NewVerifier(secret, "finance", "quant", func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		account, verifyErr := verifier.Verify(r, "/v1/integrations/finance/account")
		if verifyErr != nil {
			http.Error(w, verifyErr.Error(), http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(ReadSourceEnvelope{EnvelopeVersion: ReadSourceEnvelopeVersion, SourceID: "quant", Owner: "08-quant-lab", Network: ChainID, NativeAsset: "YNXT", AuthorizedAccount: account, OwnerContractVersion: "quant-finance-read-v1", PayloadSchema: "ynx-quant-finance-account-v1", AsOf: now, AsOfKind: "quant-tenant-states-observed-at", Coverage: "authorized strategies and executions", SyncStatus: "authoritative-persisted-quant-state", ReadOnly: true, Capabilities: append([]string(nil), acceptedReadSourceContracts["quant"].AllowedCapabilities...), Payload: json.RawMessage(`{"mandates":[{"digest":"abc"}],"executions":[{"venueStatus":"filled"}]}`)})
	}))
	defer owner.Close()
	upstreams := &Upstreams{client: owner.Client()}
	if err := upstreams.ConfigureReadSourceIntegrations(ReadSourceIntegrationConfig{QuantURL: owner.URL, QuantKey: secret}); err != nil {
		t.Fatal(err)
	}
	quant := upstreams.ReadSourcesForAccount(context.Background(), testAccount, now)["quant"]
	if !quant.OwnerContractAccepted || !quant.Status.Available || quant.Envelope == nil || quant.Envelope.AuthorizedAccount != testAccount || !strings.Contains(string(quant.Envelope.Payload), `"venueStatus":"filled"`) {
		t.Fatalf("Quant evidence was not accepted: %+v", quant)
	}
}

func TestDEXReadSourceLoadsBoundPoolAndSwapEvidence(t *testing.T) {
	now := time.Date(2026, 8, 11, 9, 37, 0, 0, time.UTC)
	secret := strings.Repeat("d", 32)
	verifier, err := readintegration.NewVerifier(secret, "finance", "dex", func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		account, verifyErr := verifier.Verify(r, "/v1/integrations/finance/account")
		if verifyErr != nil {
			http.Error(w, verifyErr.Error(), http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(ReadSourceEnvelope{EnvelopeVersion: ReadSourceEnvelopeVersion, SourceID: "dex", Owner: "27-dex", Network: ChainID, NativeAsset: "YNXT", AuthorizedAccount: account, OwnerContractVersion: "dex-finance-read-v1", PayloadSchema: "ynx-dex-finance-account-v1", AsOf: now, AsOfKind: "dex-indexer-state-observed-at", Coverage: "authorized indexed DEX account evidence", SyncStatus: "authoritative-indexed-chain-native-dex-state", ReadOnly: true, Capabilities: append([]string(nil), acceptedReadSourceContracts["dex"].AllowedCapabilities...), Payload: json.RawMessage(`{"positions":[{"pool":"dex_ynxt_yusdt","netLpAmount":"2136"}],"swaps":[{"transactionHash":"0xabc"}],"liquidity":[],"pools":[]}`)})
	}))
	defer owner.Close()
	upstreams := &Upstreams{client: owner.Client()}
	if err := upstreams.ConfigureReadSourceIntegrations(ReadSourceIntegrationConfig{DEXURL: owner.URL, DEXKey: secret}); err != nil {
		t.Fatal(err)
	}
	dex := upstreams.ReadSourcesForAccount(context.Background(), testAccount, now)["dex"]
	if !dex.OwnerContractAccepted || !dex.Status.Available || dex.Envelope == nil || !strings.Contains(string(dex.Envelope.Payload), `"netLpAmount":"2136"`) {
		t.Fatalf("DEX evidence was not accepted: %+v", dex)
	}
}

func TestExchangeReadSourceConfigurationFailsClosed(t *testing.T) {
	upstreams := &Upstreams{}
	for _, config := range []ReadSourceIntegrationConfig{
		{ExchangeURL: "https://exchange.example"},
		{ExchangeKey: strings.Repeat("x", 32)},
		{ExchangeURL: "not-a-url", ExchangeKey: strings.Repeat("x", 32)},
		{ExchangeURL: "https://exchange.example", ExchangeKey: "short"},
		{QuantURL: "https://quant.example"},
		{QuantKey: strings.Repeat("q", 32)},
		{QuantURL: "not-a-url", QuantKey: strings.Repeat("q", 32)},
		{QuantURL: "https://quant.example", QuantKey: "short"},
		{DEXURL: "https://dex.example"},
		{DEXKey: strings.Repeat("d", 32)},
		{DEXURL: "not-a-url", DEXKey: strings.Repeat("d", 32)},
		{DEXURL: "https://dex.example", DEXKey: "short"},
	} {
		if err := upstreams.ConfigureReadSourceIntegrations(config); err == nil {
			t.Fatalf("invalid integration config accepted: %+v", config)
		}
	}
}

func TestValidateReadSourceEnvelopeFailsClosed(t *testing.T) {
	now := time.Date(2026, 7, 27, 14, 0, 0, 0, time.UTC)
	contract := AcceptedReadSourceContract{
		Accepted:             true,
		SourceID:             "exchange",
		Owner:                "07-exchange",
		OwnerContractVersion: "exchange-read-v1",
		PayloadSchema:        "exchange-account-evidence-v1",
		AllowedCapabilities:  []string{"exchange.subaccounts.read", "exchange.positions.read", "exchange.withdrawals.read"},
	}
	valid := ReadSourceEnvelope{
		EnvelopeVersion:      ReadSourceEnvelopeVersion,
		SourceID:             "exchange",
		Owner:                "07-exchange",
		Network:              ChainID,
		NativeAsset:          "YNXT",
		AuthorizedAccount:    testAccount,
		OwnerContractVersion: "exchange-read-v1",
		PayloadSchema:        "exchange-account-evidence-v1",
		AsOf:                 now.Add(-time.Minute),
		AsOfKind:             "exchange-ledger-observed-at",
		Coverage:             "authorized subaccount positions at the reported cursor",
		SyncStatus:           "complete-for-reported-cursor",
		ReadOnly:             true,
		Capabilities:         []string{"exchange.subaccounts.read", "exchange.positions.read", "exchange.withdrawals.read"},
		Payload:              json.RawMessage(`{"subaccounts":[]}`),
	}
	raw, err := json.Marshal(valid)
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := ValidateReadSourceEnvelope(raw, testAccount, contract, now)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.SourceID != "exchange" || string(accepted.Payload) != `{"subaccounts":[]}` {
		t.Fatalf("valid read-source envelope changed: %+v", accepted)
	}

	pending := contract
	pending.Accepted = false
	if _, err := ValidateReadSourceEnvelope(raw, testAccount, pending, now); err == nil || !strings.Contains(err.Error(), "not accepted") {
		t.Fatalf("pending owner contract was accepted: %v", err)
	}

	cases := []struct {
		name   string
		mutate func(*ReadSourceEnvelope)
		want   string
	}{
		{name: "wrong account", mutate: func(value *ReadSourceEnvelope) { value.AuthorizedAccount = "ynx1other" }, want: "account"},
		{name: "wrong network", mutate: func(value *ReadSourceEnvelope) { value.Network = "ynx_9999-1" }, want: "network"},
		{name: "wrong asset", mutate: func(value *ReadSourceEnvelope) { value.NativeAsset = "USD" }, want: "asset"},
		{name: "wrong owner version", mutate: func(value *ReadSourceEnvelope) { value.OwnerContractVersion = "exchange-read-v2" }, want: "version"},
		{name: "future evidence", mutate: func(value *ReadSourceEnvelope) { value.AsOf = now.Add(10 * time.Minute) }, want: "future"},
		{name: "missing payload", mutate: func(value *ReadSourceEnvelope) { value.Payload = nil }, want: "payload"},
		{name: "write envelope", mutate: func(value *ReadSourceEnvelope) { value.ReadOnly = false }, want: "read-only"},
		{name: "disguised withdrawal execution", mutate: func(value *ReadSourceEnvelope) { value.Capabilities = []string{"exchange.withdraw.execute.read"} }, want: "mutation"},
		{name: "unaccepted capability", mutate: func(value *ReadSourceEnvelope) { value.Capabilities = []string{"exchange.orders.read"} }, want: "not accepted"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			value := valid
			value.Capabilities = append([]string(nil), valid.Capabilities...)
			value.Payload = append(json.RawMessage(nil), valid.Payload...)
			tc.mutate(&value)
			raw, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := ValidateReadSourceEnvelope(raw, testAccount, contract, now); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("%s did not fail closed: %v", tc.name, err)
			}
		})
	}

	withUnknown := append(raw[:len(raw)-1], []byte(`,"unexpected":true}`)...)
	if _, err := ValidateReadSourceEnvelope(withUnknown, testAccount, contract, now); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown read-source field was accepted: %v", err)
	}
}

func TestAcceptedContractCannotDeclareMutationCapability(t *testing.T) {
	contract := AcceptedReadSourceContract{
		Accepted:             true,
		SourceID:             "quant",
		Owner:                "08-quant-lab",
		OwnerContractVersion: "quant-read-v1",
		PayloadSchema:        "quant-evidence-v1",
		AllowedCapabilities:  []string{"quant.mandate.write.read"},
	}
	if _, err := ValidateReadSourceEnvelope([]byte(`{}`), testAccount, contract, time.Now().UTC()); err == nil || !strings.Contains(err.Error(), "mutation") {
		t.Fatalf("mutation-bearing accepted contract was not rejected: %v", err)
	}
}
