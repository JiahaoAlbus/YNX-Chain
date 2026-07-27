package consensus

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGovernanceExecutionCommitsDeterministicallyPersistsAndAudits(t *testing.T) {
	key := deterministicPrivateKey(151)
	signer := mustNativeAddress(t, key)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_, _ = devnet.Faucet(signer, 100)
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	blockTime := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	beginInput := GovernanceExecutionBeginPayload{
		ProposalID: strings.Repeat("1", 64), ActionHash: strings.Repeat("2", 64),
		ManifestHash: strings.Repeat("3", 64), GovernanceAuditHash: strings.Repeat("4", 64),
		TimelockAuditHash: strings.Repeat("5", 64), CanaryAuditHash: strings.Repeat("6", 64),
		EvidenceHash: strings.Repeat("7", 64), Scope: "protocol.upgrade",
		EarliestExecution: blockTime.Add(-time.Minute), LatestExecution: blockTime.Add(time.Hour),
	}
	beginRaw := mustGovernanceExecutionAction(t, key, ActionGovernanceExecutionBegin, beginInput, 1)
	beginHash := ApplicationActionHash(beginRaw)
	verifyInput := GovernanceExecutionVerifyPayload{
		ProposalID: beginInput.ProposalID, BeginTxHash: beginHash, ActionHash: beginInput.ActionHash,
		ManifestHash: beginInput.ManifestHash, Outcome: "verified", StateRoot: strings.Repeat("8", 64),
		EvidenceHash: strings.Repeat("9", 64),
	}
	verifyRaw := mustGovernanceExecutionAction(t, key, ActionGovernanceExecutionVerify, verifyInput, 2)

	var expectedHash string
	for i := 0; i < 4; i++ {
		statePath := filepath.Join(t.TempDir(), "state.json")
		app, err := NewPersistentApplication(migration, statePath)
		if err != nil {
			t.Fatal(err)
		}
		height := int64(migration.Height) + 1
		commitGovernanceExecutionBlock(t, app, height, blockTime, beginRaw)
		commitGovernanceExecutionBlock(t, app, height+1, blockTime.Add(time.Minute), verifyRaw)

		var state CommittedState
		queryJSON(t, app, "/state", &state)
		if i == 0 {
			expectedHash = state.AppHash
		} else if state.AppHash != expectedHash {
			t.Fatalf("four-application AppHash mismatch: %s != %s", state.AppHash, expectedHash)
		}
		var execution BFTGovernanceExecution
		queryJSON(t, app, "/governance/executions/"+beginInput.ProposalID, &execution)
		if execution.Status != "verified" || execution.Signer != signer || execution.BeginTxHash != beginHash ||
			execution.VerifyTxHash != ApplicationActionHash(verifyRaw) || execution.StateRoot != verifyInput.StateRoot {
			t.Fatalf("unexpected canonical execution: %+v", execution)
		}
		var audit []BFTGovernanceExecutionAudit
		queryJSON(t, app, "/governance/execution-audit", &audit)
		if len(audit) != 2 || audit[0].Sequence != 1 || audit[1].Sequence != 2 ||
			audit[1].PreviousHash != audit[0].AuditHash || audit[1].Status != "verified" {
			t.Fatalf("unexpected governance audit chain: %+v", audit)
		}
		account := queryConsensusAccount(t, app, signer)
		if account.Nonce != 2 || account.Balance != accountByAddress(t, migration.Accounts, signer).Balance-2 ||
			account.ResourceUsage.AICreditsUsed != 0 || account.ResourceUsage.PayCreditsUsed != 0 || account.ResourceUsage.TrustUsed != 0 {
			t.Fatalf("unexpected governance accounting: %+v", account)
		}
		restarted, err := NewPersistentApplication(migration, statePath)
		if err != nil {
			t.Fatal(err)
		}
		var restored BFTGovernanceExecution
		queryJSON(t, restarted, "/governance/executions/"+beginInput.ProposalID, &restored)
		if string(mustJSON(t, restored)) != string(mustJSON(t, execution)) {
			t.Fatal("governance execution changed after restart")
		}
	}
}

func TestGovernanceExecutionFailsClosedOnWindowBindingSignerReplayAndTamper(t *testing.T) {
	key, attackerKey := deterministicPrivateKey(152), deterministicPrivateKey(153)
	signer, attacker := mustNativeAddress(t, key), mustNativeAddress(t, attackerKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_, _ = devnet.Faucet(signer, 100)
	_, _ = devnet.Faucet(attacker, 100)
	devnet.ProduceBlock()
	migration, _ := devnet.ExportConsensusMigrationState()
	statePath := filepath.Join(t.TempDir(), "state.json")
	app, _ := NewPersistentApplication(migration, statePath)
	blockTime := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	begin := GovernanceExecutionBeginPayload{
		ProposalID: strings.Repeat("a", 64), ActionHash: strings.Repeat("b", 64), ManifestHash: strings.Repeat("c", 64),
		GovernanceAuditHash: strings.Repeat("d", 64), TimelockAuditHash: strings.Repeat("e", 64),
		CanaryAuditHash: strings.Repeat("f", 64), EvidenceHash: strings.Repeat("1", 64), Scope: "treasury.policy",
		EarliestExecution: blockTime.Add(-time.Minute), LatestExecution: blockTime.Add(time.Hour),
	}
	beginRaw := mustGovernanceExecutionAction(t, key, ActionGovernanceExecutionBegin, begin, 1)
	height := int64(migration.Height) + 1
	commitGovernanceExecutionBlock(t, app, height, blockTime, beginRaw)

	replay, _ := app.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: beginRaw})
	if replay.Code != CodeInvalidNonce {
		t.Fatalf("exact replay was not rejected by nonce: %+v", replay)
	}
	wrongBinding := GovernanceExecutionVerifyPayload{
		ProposalID: begin.ProposalID, BeginTxHash: ApplicationActionHash(beginRaw), ActionHash: begin.ActionHash,
		ManifestHash: strings.Repeat("0", 64), Outcome: "verified", StateRoot: strings.Repeat("2", 64), EvidenceHash: strings.Repeat("3", 64),
	}
	assertGovernanceExecutionRejected(t, app, mustGovernanceExecutionAction(t, key, ActionGovernanceExecutionVerify, wrongBinding, 2), "changed manifest")
	correct := wrongBinding
	correct.ManifestHash = begin.ManifestHash
	assertGovernanceExecutionRejected(t, app, mustGovernanceExecutionAction(t, attackerKey, ActionGovernanceExecutionVerify, correct, 1), "wrong signer")

	expired := begin
	expired.ProposalID = strings.Repeat("4", 64)
	expired.EarliestExecution, expired.LatestExecution = blockTime.Add(-2*time.Hour), blockTime.Add(-time.Hour)
	expiredRaw := mustGovernanceExecutionAction(t, key, ActionGovernanceExecutionBegin, expired, 2)
	finalized, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height + 1, Time: blockTime, Txs: [][]byte{expiredRaw}})
	if err != nil || finalized.TxResults[0].Code == 0 {
		t.Fatalf("expired timelock window accepted: %+v err=%v", finalized, err)
	}
	if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}

	var state CommittedState
	queryJSON(t, app, "/state", &state)
	state.GovernanceExecutionAudit[0].PreviousHash = strings.Repeat("9", 64)
	payload, _ := json.Marshal(state)
	if err := os.WriteFile(statePath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPersistentApplication(migration, statePath); err == nil {
		t.Fatal("tampered governance audit chain loaded")
	}
}

func mustGovernanceExecutionAction(t *testing.T, key *secp256k1.PrivateKey, action string, input any, nonce uint64) []byte {
	t.Helper()
	tx, err := NewSignedApplicationAction(key, 6423, action, input, nonce)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func commitGovernanceExecutionBlock(t *testing.T, app *Application, height int64, blockTime time.Time, raw []byte) {
	t.Helper()
	ctx := context.Background()
	proposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: [][]byte{raw}})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("governance proposal rejected: %+v err=%v", proposal, err)
	}
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: [][]byte{raw}})
	if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != 0 ||
		len(finalized.TxResults[0].Events) != 1 || finalized.TxResults[0].Events[0].Type != "ynx.governance_execution" {
		t.Fatalf("governance execution block failed: %+v err=%v", finalized, err)
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
}

func assertGovernanceExecutionRejected(t *testing.T, app *Application, raw []byte, label string) {
	t.Helper()
	response, err := app.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: raw})
	if err != nil || response.Code == 0 {
		t.Fatalf("%s passed CheckTx: %+v err=%v", label, response, err)
	}
}
