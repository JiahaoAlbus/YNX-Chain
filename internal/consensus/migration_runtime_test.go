package consensus

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// Construct an actual pre-v2 migration document for historical loader tests;
// changing only the version of a modern document is not a legacy fixture.
func legacyMigrationForTest(t *testing.T, m chain.ConsensusMigrationState) chain.ConsensusMigrationState {
	t.Helper()
	m.Version, m.SourceFormat = chain.LegacyConsensusMigrationVersion, "ynx-devnet-state-v1"
	m.Runtime, m.AccountPolicy, m.OriginalGenesisHash, m.StateHash = nil, nil, "", ""
	wire, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(wire)
	m.StateHash = hex.EncodeToString(digest[:])
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestMigrationExecutionClosureRefusesBusinessErasure(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.CreatePayIntentWithIdempotency("merchant-without-chain-signer", 10, "", "source-request"); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	blockers := MigrationExecutionBlockers(m)
	if len(blockers) == 0 || blockers[0].Module != "pay" {
		t.Fatalf("missing source compatibility blocker: %+v", blockers)
	}
	if err := validateMigrationExecutionClosure(m); err == nil || !strings.Contains(err.Error(), "pay(") {
		t.Fatalf("unresolved source Pay authority was reported fully executable: %v", err)
	}
	app, err := NewApplication(m)
	if err != nil {
		t.Fatal("strictly preserved Pay records blocked unrelated Chain initialization", err)
	}
	if app.committed.LegacyPaySource == nil || len(app.committed.LegacyPaySource.Intents) != len(m.Runtime.PayIntents) || len(app.committed.PayIntents) != 0 {
		t.Fatal("source Pay state was silently initialized empty or assigned BFT authority")
	}
}

func TestMigrationTraceReadsOriginalMetadata(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	owner := mustNativeAddress(t, deterministicPrivateKey(71))
	if _, err := d.Faucet(owner, 10); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	a, err := NewApplication(m)
	if err != nil {
		t.Fatal(err)
	}
	response, err := a.Query(context.Background(), &abcitypes.RequestQuery{Path: "/trust/trace/" + owner})
	if err != nil {
		t.Fatal(err)
	}
	var trace chain.TrustTrace
	if err := json.Unmarshal(response.Value, &trace); err != nil {
		t.Fatal(err)
	}
	if len(trace.Lots) == 0 {
		t.Fatal("migration trace lost source lots")
	}
	for _, lot := range trace.Lots {
		original := m.Runtime.Lots[lot.LotID]
		if lot.Origin != original.Origin || lot.RiskWeight != original.RiskWeight || lot.LastInbound != original.LastInbound {
			t.Fatal("source trace provenance was replaced with generic lineage")
		}
	}
}
