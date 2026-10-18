package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestVerifyMigrationState(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	if _, err := devnet.Faucet("ynx_migration_verifier", 25); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	payload, err := migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "migration.json")
	if err := os.WriteFile(path, append(payload, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	verified, err := verifyMigrationState(path)
	if err != nil {
		t.Fatal(err)
	}
	if verified.StateHash != migration.StateHash || verified.Height != migration.Height {
		t.Fatalf("verified migration mismatch: %+v", verified)
	}

	var tamperedState map[string]any
	if err := json.Unmarshal(payload, &tamperedState); err != nil {
		t.Fatal(err)
	}
	tamperedState["height"] = migration.Height + 1
	tampered, err := json.Marshal(tamperedState)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyMigrationState(path); err == nil {
		t.Fatal("tampered migration state passed verification")
	}
}

func writeMigrationFixture(t *testing.T, migration chain.ConsensusMigrationState) (string, []byte) {
	t.Helper()
	payload, err := migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	payload = append(payload, '\n')
	path := filepath.Join(t.TempDir(), "migration.json")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	return path, payload
}

func assertMigrationFileUnchanged(t *testing.T, path string, original []byte, before os.FileInfo) {
	t.Helper()
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(before, after) || before.Size() != after.Size() || before.Mode() != after.Mode() || !before.ModTime().Equal(after.ModTime()) || !bytes.Equal(actual, original) {
		t.Fatal("read-only verification changed the original migration document")
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil || len(entries) != 1 || entries[0].Name() != "migration.json" {
		t.Fatalf("read-only verification created an artifact: %v %v", entries, err)
	}
}

func TestVerifyMigrationExecutionReadOnlyCompiledSource(t *testing.T) {
	// Real source business, including an executed compiled write, must survive
	// export and the compatibility check. No Application or validator keys are
	// manufactured to make an unbound source document pass.
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	owner := "0x" + strings.Repeat("11", 20)
	if _, err := d.Faucet(owner, 1000); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
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
	if migration.Runtime == nil || len(migration.ContractMaterials) == 0 || migration.Runtime.Contracts[contract.Address].RuntimeStorage["0x"+strings.Repeat("0", 64)] != "0x"+strings.Repeat("0", 63)+"c" {
		t.Fatal("source fixture did not retain actual compiled code and the executed counter value")
	}
	if err := migration.ValidateConsensusValidatorKeys(); err == nil {
		t.Fatal("fixture unexpectedly has bound consensus validator keys")
	}
	path, original := writeMigrationFixture(t, migration)
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	var output, diagnostics bytes.Buffer
	if err := runCommand([]string{"-verify-migration-execution", path}, &output, &diagnostics); err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprintf("consensus migration execution passed: height=%d lastBlockHash=%s stateHash=%s blockers=0 scope=executor-compatibility-only validatorBinding=unchecked applicationRestore=unchecked deployment=not-performed initChain=not-performed pqActivation=not-performed\n", migration.Height, migration.LastBlockHash, migration.StateHash)
	if output.String() != want || diagnostics.Len() != 0 {
		t.Fatalf("execution completion scope differs: %q %q", output.String(), diagnostics.String())
	}
	verified, err := verifyMigrationExecution(path)
	if err != nil || verified.StateHash != migration.StateHash || len(consensus.MigrationExecutionBlockers(verified)) != 0 {
		t.Fatalf("source compatibility result differs: %v", err)
	}
	assertMigrationFileUnchanged(t, path, original, before)

	t.Run("missing-real-compiler-material", func(t *testing.T) {
		missing := migration
		missing.ContractMaterials, missing.StateHash = nil, ""
		payload, err := json.Marshal(missing)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(payload)
		missing.StateHash = hex.EncodeToString(digest[:])
		// A source checkpoint without transported execution material remains
		// structurally inspectable. This reseal grants no execution authority.
		path, original := writeMigrationFixture(t, missing)
		before, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := verifyMigrationState(path); err != nil {
			t.Fatalf("original structural verifier changed semantics: %v", err)
		}
		var out, diagnostic bytes.Buffer
		if err := runCommand([]string{"-verify-migration-execution", path}, &out, &diagnostic); err == nil || !strings.Contains(err.Error(), "contracts/"+contract.Address) {
			t.Fatalf("missing real compiled material was executable: %v", err)
		}
		if out.Len() != 0 {
			t.Fatalf("blocked execution emitted success: %q", out.String())
		}
		assertMigrationFileUnchanged(t, path, original, before)
	})
}

func TestVerifyMigrationExecutionPreservesUnsupportedOriginalRecords(t *testing.T) {
	// This exercises the original Chain source API and its preserved records;
	// it does not add authority or implement the blocked application module.
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.CreatePayIntentWithIdempotency("original-source-merchant", 10, "", "source-request"); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if migration.Runtime == nil || len(migration.Runtime.PayIntents) == 0 {
		t.Fatal("real incompatible source records are missing")
	}
	path, original := writeMigrationFixture(t, migration)
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	var oldOutput, diagnostics bytes.Buffer
	if err := runCommand([]string{"-verify-migration-state", path}, &oldOutput, &diagnostics); err != nil {
		t.Fatalf("structural verification must still accept the preserved source: %v", err)
	}
	want := fmt.Sprintf("consensus migration state passed: height=%d lastBlockHash=%s stateHash=%s accounts=%d validators=%d\n", migration.Height, migration.LastBlockHash, migration.StateHash, len(migration.Accounts), len(migration.Validators))
	if oldOutput.String() != want {
		t.Fatalf("old success line changed: %q", oldOutput.String())
	}
	var out bytes.Buffer
	if err := runCommand([]string{"-verify-migration-execution", path}, &out, &diagnostics); err == nil || !strings.Contains(err.Error(), `"module":"pay"`) {
		t.Fatalf("incompatible source records were silently erased: %v", err)
	}
	if out.Len() != 0 {
		t.Fatalf("blocked execution emitted success: %q", out.String())
	}
	assertMigrationFileUnchanged(t, path, original, before)
}

func TestConsensusPackageVerificationModesRejectMixedOrExtraArguments(t *testing.T) {
	modes := []string{"-verify-package", "-verify-migration-state", "-verify-migration-execution"}
	for _, mode := range modes {
		for _, other := range modes {
			if mode != other {
				t.Run(mode+"+"+other, func(t *testing.T) {
					var out, diagnostic bytes.Buffer
					if err := runCommand([]string{mode, "existing", other, ""}, &out, &diagnostic); err == nil || !strings.Contains(err.Error(), "mutually exclusive") || out.Len() != 0 {
						t.Fatalf("mixed verification modes accepted: %v %q", err, out.String())
					}
				})
			}
		}
		for _, generation := range []string{"-migration-state", "-validator-manifest", "-genesis-time", "-output"} {
			t.Run(mode+"+"+generation, func(t *testing.T) {
				var out, diagnostic bytes.Buffer
				if err := runCommand([]string{mode, "existing", generation, ""}, &out, &diagnostic); err == nil || !strings.Contains(err.Error(), "cannot be combined") || out.Len() != 0 {
					t.Fatalf("verification acquired generation flags: %v %q", err, out.String())
				}
			})
		}
		for _, args := range [][]string{{mode, "existing", "extra"}, {mode, "existing", "--", "extra"}, {mode, ""}, {mode, "existing", "-unknown"}} {
			var out, diagnostic bytes.Buffer
			if err := runCommand(args, &out, &diagnostic); err == nil || out.Len() != 0 {
				t.Fatalf("invalid arguments accepted: %v %v %q", args, err, out.String())
			}
		}
	}
	var out, diagnostic bytes.Buffer
	if err := runCommand([]string{"extra"}, &out, &diagnostic); err == nil || !strings.Contains(err.Error(), "positional") {
		t.Fatalf("generation accepted an extra positional argument: %v", err)
	}
}

func TestVerifyMigrationExecutionRetainsStrictLoader(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	if _, err := d.Faucet("ynx_strict_execution_loader", 25); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	_, original := writeMigrationFixture(t, migration)
	for _, kind := range []string{"unknown", "trailing", "hash"} {
		t.Run(kind, func(t *testing.T) {
			payload := bytes.Clone(original)
			if kind == "trailing" {
				payload = append(payload, []byte("{}\n")...)
			} else {
				var document map[string]any
				if err := json.Unmarshal(payload, &document); err != nil {
					t.Fatal(err)
				}
				if kind == "unknown" {
					document["unrecognizedExecutionAuthority"] = true
				} else {
					document["stateHash"] = strings.Repeat("0", 64)
				}
				payload, err = json.Marshal(document)
				if err != nil {
					t.Fatal(err)
				}
			}
			path := filepath.Join(t.TempDir(), "migration.json")
			if err := os.WriteFile(path, payload, 0o600); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			for _, mode := range []string{"-verify-migration-state", "-verify-migration-execution"} {
				var out, diagnostic bytes.Buffer
				if err := runCommand([]string{mode, path}, &out, &diagnostic); err == nil || out.Len() != 0 {
					t.Fatalf("%s accepted %s: %v %q", mode, kind, err, out.String())
				}
			}
			assertMigrationFileUnchanged(t, path, payload, before)
		})
	}
	missing := filepath.Join(t.TempDir(), "missing.json")
	if _, err := verifyMigrationExecution(missing); err == nil {
		t.Fatal("missing source document was accepted")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatalf("missing source was created: %v", err)
	}
}
