package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
)

// Real original source APIs, compiled contract execution and export. These
// synthetic records prove import behavior, never public deployment or source
// merchant/principal/reviewer authority. No validator keys are generated.
func migrationPreservationFixture(t *testing.T) (string, []byte, chain.ConsensusMigrationState) {
	t.Helper()
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	owner := "0x" + strings.Repeat("11", 20)
	for _, address := range []string{owner, "original-account-label", "0x" + strings.Repeat("22", 20)} {
		if _, err := d.Faucet(address, 1000); err != nil {
			t.Fatal(err)
		}
	}
	d.ProduceBlock()
	if _, err := d.Transfer(owner, "0x"+strings.Repeat("22", 20), 7); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if _, err := d.CreatePayIntentWithIdempotency("unbound-original-merchant", 10, "", "original-intent"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.RequestAIPermission(chain.AIPermissionInput{SessionID: "source-session", Requester: owner, Scope: "wallet_transfer", Purpose: "original unsigned source permission", ExpiryHours: 2}); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ProposeAIAction(chain.AIActionProposalInput{SessionID: "source-session", Requester: owner, Scope: "wallet_transfer", ActionType: "transfer", Description: "original unsigned proposal", ExpiryHours: 2}); err != nil {
		t.Fatal(err)
	}
	request, err := d.CreateGovernanceRequest(chain.GovernanceRequestInput{Requester: owner, Subject: owner, Action: "add risk label", AssetType: "address", Scope: "one address", Description: "original advisory request", Evidence: []string{"case:source"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.CreateTrustAppeal(chain.TrustAppealInput{RequestID: request.ID, Subject: owner, Appellant: "original-unbound-claimant", Claimant: "original-unbound-claimant", Reason: "original appeal"}); err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join("..", "..", "contracts", "devtools", "SampleEVMWriteCounter.sol"))
	if err != nil {
		t.Fatal(err)
	}
	contract, _, err := d.DeployContractWithArgs(owner, "SampleEVMWriteCounter", strings.TrimSpace(string(source)), []string{"7"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := d.ExecuteContract(owner, contract.Address, "0x7cf5dab0"+strings.Repeat("0", 63)+"5"); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if migration.Runtime == nil || len(migration.Runtime.Blocks) < 3 || len(migration.Runtime.Contracts) != 1 || migration.Runtime.Contracts[contract.Address].RuntimeStorage["0x"+strings.Repeat("0", 64)] != "0x"+strings.Repeat("0", 63)+"c" {
		t.Fatal("fixture lost real original multi-block/contract execution")
	}
	if err := migration.ValidateConsensusValidatorKeys(); err == nil {
		t.Fatal("fixture must remain unbound; no bootstrap authority")
	}
	path, raw := writeMigrationFixture(t, migration)
	return path, raw, migration
}

func TestMigrationPreservationNormalCommandImportsCompleteSource(t *testing.T) {
	path, raw, migration := migrationPreservationFixture(t)
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	var output, diagnostics bytes.Buffer
	if err := runCommand([]string{"-verify-migration-preservation", path}, &output, &diagnostics); err != nil {
		t.Fatal(err)
	}
	var result migrationPreservationResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	var txs uint64
	for _, block := range migration.Runtime.Blocks {
		txs += uint64(len(block.Transactions))
	}
	if diagnostics.Len() != 0 || output.Len() > 64<<10 || result.Version != migrationPreservationVersion || result.Classification != "data" || result.Scope != "unbound-application-import" || result.SourceSHA256 != hex.EncodeToString(digest[:]) || result.SourceBytes != strconv.Itoa(len(raw)) || result.Height != strconv.FormatUint(migration.Height, 10) || result.StateHash != migration.StateHash || result.LastBlockHash != migration.LastBlockHash {
		t.Fatalf("normal preservation receipt differs: %+v %q", result, diagnostics.String())
	}
	if result.ApplicationImport != "verified" || result.InfoInitialized || !result.AccountPolicyChecked || result.AccountsChecked != strconv.Itoa(len(migration.Accounts)) || result.ContractsChecked != "1" || result.HistoryBlocksChecked != strconv.Itoa(len(migration.Runtime.Blocks)) || result.HistoryTxsChecked != strconv.FormatUint(txs, 10) {
		t.Fatalf("receipt did not check every actual original item: %+v", result)
	}
	if result.PersistedColdRestore != "unchecked" || result.ValidatorBinding != "unchecked" || result.ExecutionCapabilities != "unresolved" || result.Deployment != "not-performed" || result.InitChain != "not-performed" || result.PQActivation != "not-performed" || !reflect.DeepEqual(result.Blockers, consensus.MigrationExecutionBlockers(migration)) || len(result.Blockers) != 3 {
		t.Fatalf("import invented execution/validator/persistence/activation qualification: %+v", result)
	}
	canonical, err := json.Marshal(result)
	if err != nil || !bytes.Equal(output.Bytes(), append(canonical, '\n')) {
		t.Fatal("preservation output is not one bounded canonical receipt")
	}
	// The same original document still fails the existing strict execution
	// check, and neither mode may erase or rewrite it to manufacture success.
	output.Reset()
	if err := runCommand([]string{"-verify-migration-execution", path}, &output, &diagnostics); err == nil || !strings.Contains(err.Error(), `"module":"pay"`) || !strings.Contains(err.Error(), `"module":"ai"`) || !strings.Contains(err.Error(), `"module":"trust_governance"`) || output.Len() != 0 {
		t.Fatalf("preservation cleared existing execution blockers: %v", err)
	}
	assertMigrationFileUnchanged(t, path, raw, before)
	t.Run("ordinary-contract-blocker-still-refused", func(t *testing.T) {
		missing := migration
		missing.ContractMaterials, missing.StateHash = nil, ""
		payload, err := json.Marshal(missing)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(payload)
		missing.StateHash = hex.EncodeToString(digest[:])
		path, raw := writeMigrationFixture(t, missing)
		before, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		var output, diagnostics bytes.Buffer
		if err := runCommand([]string{"-verify-migration-preservation", path}, &output, &diagnostics); err == nil || !strings.Contains(err.Error(), "contracts/") || output.Len() != 0 {
			t.Fatalf("preservation waived missing execution material: %v", err)
		}
		assertMigrationFileUnchanged(t, path, raw, before)
	})
}

func TestMigrationPreservationNormalCommandNoListedBlockers(t *testing.T) {
	path, raw, migration := migrationSummaryFixture(t)
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	var output, diagnostics bytes.Buffer
	if err := runCommand([]string{"--verify-migration-preservation=" + path}, &output, &diagnostics); err != nil {
		t.Fatal(err)
	}
	var result migrationPreservationResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil || diagnostics.Len() != 0 || result.Blockers == nil || len(result.Blockers) != 0 || result.ExecutionCapabilities != "no-listed-blockers" || result.HistoryBlocksChecked != strconv.Itoa(len(migration.Runtime.Blocks)) || result.PersistedColdRestore != "unchecked" || result.ValidatorBinding != "unchecked" {
		t.Fatal("blocker-free import invented persistent/validator qualification", err)
	}
	assertMigrationFileUnchanged(t, path, raw, before)
}

func TestMigrationPreservationRejectsArgumentsBeforeRead(t *testing.T) {
	missing := filepath.Join(canonicalPackageTempDir(t), "must-not-open")
	for _, other := range []string{"-verify-package", "-verify-migration-state", "-verify-migration-execution"} {
		for _, args := range [][]string{{"-verify-migration-preservation", missing, other, missing}, {other, missing, "-verify-migration-preservation", missing}} {
			var output, diagnostics bytes.Buffer
			if err := runCommand(args, &output, &diagnostics); err == nil || !strings.Contains(err.Error(), "mutually exclusive") || output.Len() != 0 {
				t.Fatalf("mixed preservation mode reached I/O: %q %v", args, err)
			}
		}
	}
	cases := [][]string{
		{"-verify-migration-preservation", ""},
		{"-verify-migration-preservation", missing, "--verify-migration-preservation=" + missing},
		{"--verify-migration-preservation=" + missing, "-verify-migration-preservation", missing},
		{"-verify-migration-preservation", missing, "-migration-public-summary", "json"},
		{"-verify-migration-preservation", missing, "-operator-plan-hash", strings.Repeat("a", 64)},
		{"-verify-migration-preservation", missing, "positional"},
		{"-verify-migration-preserv", missing},
	}
	for _, flag := range []string{"-migration-state", "-validator-manifest", "-genesis-time", "-output", "-operator-plan"} {
		cases = append(cases, []string{"-verify-migration-preservation", missing, flag, missing})
	}
	for _, args := range cases {
		var output, diagnostics bytes.Buffer
		if err := runCommand(args, &output, &diagnostics); err == nil || strings.Contains(err.Error(), "symlinks") || strings.Contains(err.Error(), "no such file") || output.Len() != 0 {
			t.Fatalf("invalid preservation options reached source read: %q %v", args, err)
		}
	}
	if _, err := os.Lstat(missing); !os.IsNotExist(err) {
		t.Fatal("rejected CLI created missing input", err)
	}
}

func TestMigrationPreservationRejectsInvalidSourceWithoutWrites(t *testing.T) {
	path, raw, migration := migrationSummaryFixture(t)
	for name, payload := range map[string][]byte{
		"unknown-field": append([]byte(`{"foreign":true,`), raw[1:]...),
		"trailing":      append(bytes.Clone(raw), []byte("{}")...),
		"state-hash":    bytes.Replace(raw, []byte(migration.StateHash), []byte(strings.Repeat("0", 64)), 1),
	} {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(path, payload, 0600); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			var output, diagnostics bytes.Buffer
			if err := runCommand([]string{"-verify-migration-preservation", path}, &output, &diagnostics); err == nil || output.Len() != 0 {
				t.Fatalf("invalid migration produced preservation success: %v", err)
			}
			assertMigrationFileUnchanged(t, path, payload, before)
		})
	}
}

// This wrapper keeps the normal Application queries and changes just one
// observed result. It proves complete checking (including later records),
// without using a second import implementation as a successful reference.
type preservationQueryFault struct {
	*consensus.Application
	path   string
	mutate func(*abci.ResponseQuery)
	seen   bool
}

func (f *preservationQueryFault) Query(ctx context.Context, req *abci.RequestQuery) (*abci.ResponseQuery, error) {
	r, err := f.Application.Query(ctx, req)
	if err == nil && r != nil && req.Path == f.path {
		f.seen = true
		f.mutate(r)
	}
	return r, err
}

func TestMigrationPreservationDetectsLaterQueryCorruption(t *testing.T) {
	_, _, migration := migrationPreservationFixture(t)
	app, err := consensus.NewPersistentApplication(migration, "")
	if err != nil {
		t.Fatal(err)
	}
	lastAccount := migration.Accounts[len(migration.Accounts)-1]
	lastBlock := migration.Runtime.Blocks[len(migration.Runtime.Blocks)-1]
	var contract string
	for address := range migration.Runtime.Contracts {
		contract = address
	}
	cases := []struct {
		name, path string
		mutate     func(*abci.ResponseQuery)
	}{
		{"later-account-nonce", "/accounts/" + lastAccount.Address, func(r *abci.ResponseQuery) { v := lastAccount; v.Nonce++; r.Value, _ = json.Marshal(v) }},
		{"later-account-balance", "/accounts/" + lastAccount.Address, func(r *abci.ResponseQuery) { v := lastAccount; v.Balance++; r.Value, _ = json.Marshal(v) }},
		{"contract-anchor", "/ide/source/" + contract, func(r *abci.ResponseQuery) {
			r.Value = bytes.Replace(r.Value, []byte(migration.StateHash), []byte(strings.Repeat("f", 64)), 1)
		}},
		{"last-history-block", consensus.MigrationHistoryBlockPath + strconv.FormatUint(lastBlock.Height, 10), func(r *abci.ResponseQuery) {
			r.Value = bytes.Replace(r.Value, []byte(lastBlock.Hash), []byte(strings.Repeat("e", 64)), -1)
		}},
		{"missing-history", consensus.MigrationHistoryBlockPath + strconv.FormatUint(lastBlock.Height, 10), func(r *abci.ResponseQuery) { r.Value = []byte(`{"found":false}`) }},
		{"query-height", "/accounts/" + lastAccount.Address, func(r *abci.ResponseQuery) { r.Height++ }},
		{"query-budget-error", consensus.MigrationHistoryBlockPath + strconv.FormatUint(lastBlock.Height, 10), func(r *abci.ResponseQuery) { r.Code, r.Value = 1, nil }},
		{"registry-invented", "/validator-registry", func(r *abci.ResponseQuery) { r.Value = []byte(`{}`) }},
		{"blockers-erased", "/migration/compatibility", func(r *abci.ResponseQuery) { r.Value = []byte(`[]`) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reader := &preservationQueryFault{Application: app, path: tc.path, mutate: tc.mutate}
			if _, err := checkMigrationPreservationApplication(migration, reader); err == nil || !reader.seen {
				t.Fatalf("complete original query corruption was not observed/refused: %v %v", reader.seen, err)
			}
		})
	}
	info, err := app.Info(context.Background(), &abci.RequestInfo{})
	if err != nil || info.LastBlockHeight != 0 || len(info.LastBlockAppHash) != 0 {
		t.Fatal("query checks changed the original Application initialization state", err)
	}
}

func TestMigrationPreservationStableInputIncludesWholeInspection(t *testing.T) {
	path, raw, _ := migrationSummaryFixture(t)
	// Exercise the actual shared reader with a replacement during its inspection
	// callback. The completed inspection cannot publish data for a changed input.
	called := false
	_, err := withVerifiedMigrationInput(path, func(_ chain.ConsensusMigrationState, _, _ string) ([]byte, error) {
		called = true
		other := filepath.Join(filepath.Dir(path), "replacement")
		if err := os.WriteFile(other, raw, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(other, path); err != nil {
			t.Fatal(err)
		}
		return []byte(`{"data":true}`), nil
	})
	if err == nil || !called || !strings.Contains(err.Error(), "identity changed") {
		t.Fatal("replacement after complete inspection was accepted", called, err)
	}
	// Original callback failures also remain errors and cannot become a receipt.
	want := errors.New("actual inspection refused")
	if _, err := withVerifiedMigrationInput(path, func(chain.ConsensusMigrationState, string, string) ([]byte, error) { return nil, want }); !errors.Is(err, want) {
		t.Fatal("inspection first cause changed", err)
	}
}
