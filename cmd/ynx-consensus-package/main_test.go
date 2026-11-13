package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// macOS's temporary root may use /var -> /private/var. Resolve the fixture
// parent once; explicit symlink counterexamples remain below this real parent.
// Production's original-path/no-follow requirement is deliberately unchanged.
func canonicalPackageTempDir(t *testing.T) string {
	t.Helper()
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return parent
}

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
	path := filepath.Join(canonicalPackageTempDir(t), "migration.json")
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
	path := filepath.Join(canonicalPackageTempDir(t), "migration.json")
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
		for _, generation := range []string{"-migration-state", "-validator-manifest", "-genesis-time", "-output", "-operator-plan"} {
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
			path := filepath.Join(canonicalPackageTempDir(t), "migration.json")
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
	missing := filepath.Join(canonicalPackageTempDir(t), "missing.json")
	if _, err := verifyMigrationExecution(missing); err == nil {
		t.Fatal("missing source document was accepted")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatalf("missing source was created: %v", err)
	}
}

func deriveCLIArgs(f operatorCLIFixture) []string {
	return []string{"-derive-bootstrap", "-migration-state", f.migrationPath, "-validator-manifest", f.manifestPath, "-genesis-time", f.genesisTime}
}

func TestConsensusPackageDeriveBootstrapOriginalBytesAndOperator(t *testing.T) {
	f := newOperatorCLIFixture(t)
	before, err := os.ReadDir(f.root)
	if err != nil {
		t.Fatal(err)
	}
	migrationOriginal, _ := os.ReadFile(f.migrationPath)
	manifestOriginal, _ := os.ReadFile(f.manifestPath)
	var out, diagnostic bytes.Buffer
	if err := runCommand(deriveCLIArgs(f), &out, &diagnostic); err != nil {
		t.Fatal(err)
	}
	var result map[string]string
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 6 || result["version"] != "YNX-PUBLIC-BFT-BOOTSTRAP-DERIVATION/v1" || result["genesisTime"] != f.genesisTime || result["originalGenesisHash"] != f.plan.OriginalGenesisHash || result["boundMigrationStateHash"] != f.plan.MigrationStateHash || result["consensusGenesisSHA256"] != f.plan.ConsensusGenesisSHA256 {
		t.Fatalf("invalid closed derivation: %v", result)
	}
	genesis, err := base64.StdEncoding.Strict().DecodeString(result["consensusGenesis"])
	if err != nil || base64.StdEncoding.EncodeToString(genesis) != result["consensusGenesis"] || !bytes.Equal(genesis, f.plan.ConsensusGenesis) || operatorFixtureHash(genesis) != result["consensusGenesisSHA256"] {
		t.Fatalf("different original genesis bytes: %v", err)
	}
	after, err := os.ReadDir(f.root)
	if err != nil || len(before) != len(after) {
		t.Fatalf("derive created output: %v", err)
	}
	for i := range before {
		if before[i].Name() != after[i].Name() {
			t.Fatal("derive changed its input directory")
		}
	}
	for path, original := range map[string][]byte{f.migrationPath: migrationOriginal, f.manifestPath: manifestOriginal} {
		raw, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(raw, original) {
			t.Fatalf("input changed: %s %v", path, err)
		}
	}
	// Compare against the original Comet SaveAs codec independently, not a
	// second hand-written encoder. These are public deterministic test inputs.
	migration, err := verifyMigrationState(f.migrationPath)
	if err != nil {
		t.Fatal(err)
	}
	var validators consensus.ProductionValidatorManifest
	if err := json.Unmarshal(manifestOriginal, &validators); err != nil {
		t.Fatal(err)
	}
	bindings := make([]chain.ConsensusValidatorKeyBinding, 0, 4)
	for _, v := range validators.Validators {
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.ValidatorAddress, KeyType: v.ConsensusKeyType, PublicKey: v.ConsensusPubKey, ConsensusAddress: v.ConsensusAddress})
	}
	bound, err := migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	when, err := time.Parse(time.RFC3339, f.genesisTime)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := consensus.BuildCometGenesis(bound, when)
	if err != nil {
		t.Fatal(err)
	}
	savePath := filepath.Join(canonicalPackageTempDir(t), "save-as.json")
	if err := doc.SaveAs(savePath); err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(savePath)
	if err != nil || !bytes.Equal(saved, genesis) {
		t.Fatalf("SaveAs drift: %v", err)
	}
	// The actual single-Application generator consumes the derived bytes with
	// an independently pinned plan and passes its normal full package verifier.
	plan := f.plan
	plan.ConsensusGenesis = genesis
	plan.ConsensusGenesisSHA256 = result["consensusGenesisSHA256"]
	plan.MigrationStateHash = result["boundMigrationStateHash"]
	planPath, _, planPin := writeOperatorCLIPlan(t, plan)
	packagePath := filepath.Join(canonicalPackageTempDir(t), "operator-package")
	if err := runCommand(f.generationArgs(packagePath, planPath, planPin), io.Discard, io.Discard); err != nil {
		t.Fatal(err)
	}
	if err := consensus.VerifyProductionOperatorCandidatePackage(packagePath, planPin); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(filepath.Join(packagePath, "common", "genesis.json"))
	if err != nil || !bytes.Equal(actual, genesis) {
		t.Fatalf("formal operator drift: %v", err)
	}
	t.Logf("derive bytes=%d genesis bytes=%d sameOriginalSaveAs=true sameFormalOperator=true noPackageFromDerive=true", out.Len(), len(genesis))
}

func TestConsensusPackageDeriveBootstrapRejectsInvalidInputs(t *testing.T) {
	f := newOperatorCLIFixture(t)
	manifestRaw, _ := os.ReadFile(f.manifestPath)
	var manifest consensus.ProductionValidatorManifest
	if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*consensus.ProductionValidatorManifest){
		"missing-validator": func(m *consensus.ProductionValidatorManifest) { m.Validators = m.Validators[:3] },
		"wrong-chain":       func(m *consensus.ProductionValidatorManifest) { m.ChainID = "ynx_1-1" },
		"duplicate-role":    func(m *consensus.ProductionValidatorManifest) { m.Validators[1].Role = m.Validators[0].Role },
		"wrong-public-key": func(m *consensus.ProductionValidatorManifest) {
			m.Validators[0].ConsensusPubKey = m.Validators[1].ConsensusPubKey
		},
		"wrong-address": func(m *consensus.ProductionValidatorManifest) { m.Validators[0].ValidatorAddress = "ynx_unregistered" },
	} {
		t.Run(name, func(t *testing.T) {
			m := manifest
			m.Validators = append([]consensus.ProductionValidatorNode(nil), manifest.Validators...)
			mutate(&m)
			raw, err := json.Marshal(m)
			if err != nil {
				t.Fatal(err)
			}
			bad := f
			bad.manifestPath = filepath.Join(canonicalPackageTempDir(t), "validators.json")
			if err := os.WriteFile(bad.manifestPath, raw, 0600); err != nil {
				t.Fatal(err)
			}
			var out bytes.Buffer
			if err := runCommand(deriveCLIArgs(bad), &out, io.Discard); err == nil || out.Len() != 0 {
				t.Fatalf("invalid manifest emitted DATA: %v", err)
			}
		})
	}
	for name, value := range map[string]string{"offset": "2026-08-01T01:00:00+01:00", "fraction": "2026-08-01T00:00:00.1Z", "zero": "0001-01-01T00:00:00Z", "empty": "", "invalid": "tomorrow"} {
		t.Run(name, func(t *testing.T) {
			bad := f
			bad.genesisTime = value
			var out bytes.Buffer
			if err := runCommand(deriveCLIArgs(bad), &out, io.Discard); err == nil || out.Len() != 0 {
				t.Fatalf("invalid T emitted DATA: %v", err)
			}
		})
	}
	t.Run("tampered-migration", func(t *testing.T) {
		raw, _ := os.ReadFile(f.migrationPath)
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		m["height"] = 99
		raw, _ = json.Marshal(m)
		bad := f
		bad.migrationPath = filepath.Join(canonicalPackageTempDir(t), "migration.json")
		if err := os.WriteFile(bad.migrationPath, raw, 0600); err != nil {
			t.Fatal(err)
		}
		var out bytes.Buffer
		if err := runCommand(deriveCLIArgs(bad), &out, io.Discard); err == nil || out.Len() != 0 {
			t.Fatalf("tampered M emitted DATA: %v", err)
		}
	})
	t.Run("private-manifest-field", func(t *testing.T) {
		bad := f
		bad.manifestPath = filepath.Join(canonicalPackageTempDir(t), "validators.json")
		raw := append([]byte(`{"priv_key":"synthetic-no-key",`), manifestRaw[1:]...)
		if err := os.WriteFile(bad.manifestPath, raw, 0600); err != nil {
			t.Fatal(err)
		}
		var out bytes.Buffer
		if err := runCommand(deriveCLIArgs(bad), &out, io.Discard); err == nil || out.Len() != 0 {
			t.Fatalf("private manifest emitted DATA: %v", err)
		}
	})
}

func TestConsensusPackageDeriveBootstrapStrictGrammarAndOutputFailure(t *testing.T) {
	f := newOperatorCLIFixture(t)
	base := deriveCLIArgs(f)
	for name, args := range map[string][]string{
		"false":               append([]string{"-derive-bootstrap=false"}, base[1:]...),
		"duplicate":           append(append([]string(nil), base...), "-derive-bootstrap"),
		"duplicate-migration": append(append([]string(nil), base...), "-migration-state", f.migrationPath),
		"positional":          append(append([]string(nil), base...), "unexpected"),
		"missing-validator":   base[:3],
		"package-output":      append(append([]string(nil), base...), "-output", filepath.Join(f.root, "must-not-exist")),
		"operator-plan":       append(append([]string(nil), base...), "-operator-plan", "missing", "-operator-plan-hash", strings.Repeat("1", 64)),
		"verification":        append(append([]string(nil), base...), "-verify-migration-state", f.migrationPath),
		"summary":             append(append([]string(nil), base...), "-migration-public-summary", "json"),
		"initial":             append(append([]string(nil), base...), "-prepare-pq-initial-genesis", "missing"),
	} {
		t.Run(name, func(t *testing.T) {
			var out bytes.Buffer
			if err := runCommand(args, &out, io.Discard); err == nil || out.Len() != 0 {
				t.Fatalf("mixed mode emitted DATA: %v", err)
			}
		})
	}
	if _, err := os.Stat(filepath.Join(f.root, "must-not-exist")); !os.IsNotExist(err) {
		t.Fatal("mixed derive created package")
	}
	t.Run("short-output", func(t *testing.T) {
		if err := runCommand(base, deriveShortWriter{}, io.Discard); err != io.ErrShortWrite {
			t.Fatalf("short output lost failure: %v", err)
		}
	})
}

type deriveShortWriter struct{}

func (deriveShortWriter) Write(raw []byte) (int, error) { return len(raw) - 1, nil }
