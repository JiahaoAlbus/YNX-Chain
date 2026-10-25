//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/cobra"
)

func executeProofTargetInspection(args []string) ([]byte, error) {
	var output bytes.Buffer
	root := &cobra.Command{Use: "ynx-comet", SilenceErrors: true, SilenceUsage: true, PersistentPreRunE: func(*cobra.Command, []string) error {
		return errors.New("proof target entered runtime/home-creation pre-run")
	}}
	root.AddCommand(newInspectProofHostTargetCommand())
	root.SetArgs(append([]string{"inspect-proof-host-target"}, args...))
	root.SetOut(&output)
	root.SetErr(&output)
	err := root.Execute()
	return output.Bytes(), err
}

func TestInspectProofHostTargetStrictArgumentsAndExplicitPins(t *testing.T) {
	for _, args := range [][]string{
		{}, {"--engine-height", "3"}, {"extra"},
		{"--lookup-height", "2", "--lookup-height", "3"},
		{"--source-plan", "partial.json"}, {"--now", "2026-10-19T00:00:00Z"},
		{"--rpc", "http://candidate.invalid"}, {"--backup-output", "/new"},
	} {
		out, err := executeProofTargetInspection(args)
		if err == nil || bytes.Contains(out, []byte(`"ledgerProofVerified":true`)) {
			t.Fatalf("incomplete/duplicate/runtime inputs accepted: %v %s", err, out)
		}
	}
	valid := inspectProofHostTargetFlags{height: "2", index: "0", engineHeight: "3", trustedHeight: "1", transactionHash: strings.Repeat("1", 64), nativeHash: strings.Repeat("2", 64), engineHash: strings.Repeat("3", 64), trustedHash: strings.Repeat("4", 64), period: "3600000000000", drift: "0", numerator: "1", denominator: "3"}
	if x, err := valid.target(); err != nil || x.Height != 2 || x.Index != 0 || x.EngineHeight != 3 || x.TrustedHeight != 1 || x.MaxClockDrift != 0 {
		t.Fatal("explicit canonical scalar input rejected", x, err)
	}
	for name, mutate := range map[string]func(*inspectProofHostTargetFlags){
		"checkpoint-not-supplied":     func(f *inspectProofHostTargetFlags) { f.engineHeight = "" },
		"checkpoint-zero":             func(f *inspectProofHostTargetFlags) { f.engineHeight = "0" },
		"checkpoint-before-successor": func(f *inspectProofHostTargetFlags) { f.engineHeight = "2" },
		"trusted-is-target":           func(f *inspectProofHostTargetFlags) { f.trustedHeight = "2" },
		"leading-zero":                func(f *inspectProofHostTargetFlags) { f.height = "02" },
		"index-missing":               func(f *inspectProofHostTargetFlags) { f.index = "" },
		"index-negative":              func(f *inspectProofHostTargetFlags) { f.index = "-1" },
		"index-overflow":              func(f *inspectProofHostTargetFlags) { f.index = "2147483648" },
		"hash-prefixed":               func(f *inspectProofHostTargetFlags) { f.nativeHash = "0x" + f.nativeHash },
		"hash-uppercase":              func(f *inspectProofHostTargetFlags) { f.nativeHash = strings.Repeat("A", 64) },
		"hash-zero":                   func(f *inspectProofHostTargetFlags) { f.engineHash = strings.Repeat("0", 64) },
		"default-period":              func(f *inspectProofHostTargetFlags) { f.period = "" },
		"default-fraction":            func(f *inspectProofHostTargetFlags) { f.denominator = "" },
	} {
		t.Run(name, func(t *testing.T) {
			bad := valid
			mutate(&bad)
			if _, err := bad.target(); err == nil {
				t.Fatal("missing/noncanonical independent scalar accepted")
			}
		})
	}
}

// The original full-consensus suite can retain its genuine BlockExecutor
// fixture for the subsequent normal command tests. Nothing is generated or
// substituted when that fixture was not explicitly supplied. This is not a
// production source or a Node.Start/custody qualification.
func TestInspectProofHostTargetNormalCommandRetainedFixture(t *testing.T) {
	root := os.Getenv("YNX_PROOF_HOST_SOURCE_FIXTURE_OUT")
	if root == "" {
		t.Skip("requires the explicitly retained original public engine fixture")
	}
	var original consensus.ProofHostSourcePlan
	for _, test := range []struct{ name, prefix, kind string }{
		{"transfer", "", consensus.PQTransferType},
		{"typed-action", "typed-", consensus.PQActionType},
	} {
		t.Run(test.name, func(t *testing.T) {
			plan := inspectProofHostTargetRetainedCase(t, root, test.prefix, test.kind)
			if test.prefix == "" {
				original = plan
			} else if plan.EngineHeight != original.EngineHeight || plan.EngineAppHash != original.EngineAppHash || plan.StateFile != original.StateFile || plan.CometDataDirectory != original.CometDataDirectory || plan.TrustedHeight != original.TrustedHeight || plan.TrustedBlockHash != original.TrustedBlockHash {
				t.Fatal("typed normal command substituted a different checkpoint or trust anchor")
			}
		})
	}
}

func inspectProofHostTargetRetainedCase(t *testing.T, root, prefix, wantKind string) consensus.ProofHostSourcePlan {
	t.Helper()
	metadataRaw, err := os.ReadFile(filepath.Join(root, prefix+"metadata.json"))
	if err != nil {
		t.Fatal(err)
	}
	var metadata map[string]string
	if err = json.Unmarshal(metadataRaw, &metadata); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"sourcePlanSHA256", "sourcePlanPath", "deliveryPath", "sourceId", "epoch", "requestPath", "expectedVerifierCode"} {
		if len(metadata) != 7 || metadata[key] == "" {
			t.Fatal("incomplete retained metadata", key)
		}
	}
	if metadata["sourcePlanPath"] != filepath.Join(root, prefix+"source-plan.json") || metadata["requestPath"] != filepath.Join(root, prefix+"request.json") || metadata["deliveryPath"] != filepath.Join(root, prefix+"delivery") || metadata["expectedVerifierCode"] != "VERIFIED_TRANSACTION_DATA" {
		t.Fatal("retained metadata redirected the normal caller")
	}
	raw, err := os.ReadFile(metadata["sourcePlanPath"])
	if err != nil {
		t.Fatal(err)
	}
	plan, err := consensus.DecodeProofHostSourcePlan(raw, metadata["sourcePlanSHA256"])
	if err != nil {
		t.Fatal(err)
	}
	// The already independent fixture target is only the comparison oracle.
	// No expected H/H+1 hash or partial plan is passed into the new command.
	x := plan.ExpectedTransaction
	if x.TransactionType != wantKind || x.TransactionHash == x.NativeWireHash || plan.OriginalHash != "0x"+x.NativeWireHash || plan.SourceID != metadata["sourceId"] || plan.Epoch != metadata["epoch"] {
		t.Fatal("retained target lost native/transport hash separation or changed type")
	}
	envelope, err := base64.StdEncoding.DecodeString(x.Envelope)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := base64.StdEncoding.DecodeString(x.NativeWire)
	if err != nil {
		t.Fatal(err)
	}
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	envelopePath, wirePath := filepath.Join(dir, "original-envelope"), filepath.Join(dir, "original-native-wire")
	if err = os.WriteFile(envelopePath, envelope, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(wirePath, wire, 0600); err != nil {
		t.Fatal(err)
	}
	args := []string{
		"--consensus-genesis", plan.GenesisFile, "--migration-state", plan.MigrationFile,
		"--abci-state", plan.StateFile, "--abci-state-layout", plan.StateLayout,
		"--comet-data-dir", plan.CometDataDirectory, "--signing-state", plan.SigningStatePath, "--signing-lock-kind", plan.SigningLockKind,
		"--consensus-genesis-sha256", plan.ConsensusGenesisSHA256, "--original-genesis-hash", plan.OriginalGenesisHash, "--bound-migration-state-hash", plan.MigrationStateHash,
		"--pq-engine-schedule", plan.ScheduleFile, "--pq-engine-schedule-hash", plan.ScheduleHash,
		"--account", plan.Account, "--transaction-type", x.TransactionType, "--envelope", envelopePath, "--native-wire", wirePath,
		"--transaction-hash", x.TransactionHash, "--native-wire-hash", x.NativeWireHash,
		"--lookup-height", x.Block.HeaderHeight, "--lookup-index", x.Index,
		"--engine-height", plan.EngineHeight, "--engine-app-hash", plan.EngineAppHash,
		"--trusted-height", plan.TrustedHeight, "--trusted-block-hash", plan.TrustedBlockHash,
		"--trusting-period-nanoseconds", plan.TrustingPeriodNanoseconds, "--max-clock-drift-nanoseconds", plan.MaxClockDriftNanoseconds,
		"--trust-level-numerator", plan.TrustLevelNumerator, "--trust-level-denominator", plan.TrustLevelDenominator,
	}
	if plan.RuntimePlanFile != "" {
		args = append(args, "--runtime-upgrade-plan", plan.RuntimePlanFile, "--runtime-upgrade-plan-hash", plan.RuntimePlanHash)
	}
	before := proofTargetCommandFiles(t, filepath.Join(root, "original"))
	out, err := executeProofTargetInspection(args)
	if err != nil {
		t.Fatal("normal read-only target command", err, string(out))
	}
	var result consensus.ProofHostTargetResult
	if err = json.Unmarshal(out, &result); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result.ExpectedTransaction, x) || !result.LedgerProofVerified || result.NativeRootAuthorized || result.DeploymentVerified || result.Verification.NativeGrant || result.Verification.TransactionType != wantKind || !result.Verification.ExecutionSuccessful || result.Verification.TransactionHash != x.TransactionHash || result.Verification.NativeWireHash != x.NativeWireHash {
		t.Fatal("normal target changed pinned original or claimed authority")
	}
	bad := append([]string(nil), args...)
	for i := range bad {
		if bad[i] == "--engine-app-hash" {
			bad[i+1] = strings.Repeat("e", 64)
		}
	}
	if rejected, err := executeProofTargetInspection(bad); err == nil || bytes.Contains(rejected, []byte(`"ledgerProofVerified":true`)) {
		t.Fatal("normal command adopted actual DB hash instead of independent pin", err)
	}
	if !reflect.DeepEqual(before, proofTargetCommandFiles(t, filepath.Join(root, "original"))) {
		t.Fatal("normal command changed original source")
	}
	for path, expected := range map[string][]byte{envelopePath: envelope, wirePath: wire, metadata["sourcePlanPath"]: raw} {
		actual, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(actual, expected) {
			t.Fatal("retained original input changed", err)
		}
	}
	return plan
}

func proofTargetCommandFiles(t *testing.T, root string) map[string]string {
	t.Helper()
	files := make(map[string]string)
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		hash := sha256.Sum256(raw)
		files[path] = hex.EncodeToString(hash[:])
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}
