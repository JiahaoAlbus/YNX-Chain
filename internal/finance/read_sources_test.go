package finance

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
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
		if source.OwnerContractAccepted || !source.ReadOnly || source.Status.Available || source.Status.SyncStatus != "owner-contract-pending" || source.Status.AsOf == nil || !source.Status.AsOf.Equal(observedAt) {
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
