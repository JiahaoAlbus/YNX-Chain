package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/spf13/cobra"
)

func executeWalletPolicyInspection(args []string) ([]byte, error) {
	var out bytes.Buffer
	root := &cobra.Command{Use: "ynx-comet", SilenceUsage: true, SilenceErrors: true, PersistentPreRunE: func(*cobra.Command, []string) error {
		return errors.New("readonly Wallet policy command entered node startup")
	}}
	root.AddCommand(newInspectWalletPolicyCommand())
	root.SetArgs(args)
	root.SetOut(&out)
	root.SetErr(&out)
	err := root.Execute()
	return out.Bytes(), err
}

// Reuse the normal synthetic workload producer (lawful account migration and
// dual PoP), original key binding, normal bootstrap node constructor WITHOUT
// Start, actual BlockExecutor and original durable Comet store. No observed
// RPC policy, arbitrary checkpoint JSON, or private test state setter is used.
func newWalletPolicyInspectionFixture(t *testing.T) (*cometJournalFixture, stoppedOperatorInspectionCommandFixture) {
	t.Helper()
	source, err := consensus.NewPQLabWorkloadSource(consensus.PQLabWorkloadOptions{Transfers: 1, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	m := source.Migration
	if m.AccountPolicy == nil || len(m.AccountPolicy.Records) != 1 {
		t.Fatal("normal synthetic source did not register its original account")
	}
	owner := m.AccountPolicy.Records[0].Owner
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, member := range m.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 81)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		address := sha256.Sum256(public)
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: member.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(address[:20]))})
		clear(key)
	}
	m, err = m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := consensus.BuildCometGenesis(m, time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	b, err := consensus.NewConsensusBootstrap(raw, consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(hash[:]), OriginalGenesisHash: m.OriginalGenesisHash, MigrationStateHash: m.StateHash}, m)
	if err != nil {
		t.Fatal(err)
	}
	f := &cometJournalFixture{migration: m, bootstrap: b, doc: doc, owner: owner}
	return f, newStoppedOperatorInspectionCommandFixtureWithSource(t, f, false)
}

func TestInspectWalletPolicyNormalOriginalCheckpointAndRefusals(t *testing.T) {
	source, f := newWalletPolicyInspectionFixture(t)
	args := append([]string(nil), f.args...)
	args[0] = "inspect-wallet-policy"
	args = append(args, "--owner", source.owner)
	before, err := os.ReadFile(f.options.state)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := executeWalletPolicyInspection(args)
	if err != nil {
		t.Fatal(string(raw), err)
	}
	var output walletPolicyInspection
	if err = json.Unmarshal(raw, &output); err != nil {
		t.Fatal(err)
	}
	if output.CheckpointOrigin != consensus.PQWalletPolicyLocalEngineCheckpoint || output.IndependentFinalityVerified {
		t.Fatal("local engine inspection mislabeled as independent light-client finality", string(raw))
	}
	if output.Version != "YNX-WALLET-POLICY-CHECKPOINT/v1" || output.Classification != "data" || output.Source != "original-stopped-engine-and-application" || output.Owner != source.owner || output.CommittedHeight != strconv.FormatInt(f.actual.LastBlockHeight, 10) || output.CommittedAppHash != hex.EncodeToString(f.actual.AppHash) || output.ExecutionHeight != strconv.FormatInt(f.actual.LastBlockHeight+1, 10) || output.LedgerNonce != "1" || output.NativeGrant || output.LiveCurrentVerified || !output.CheckpointOnly {
		t.Fatal("normal command invented authority or selected an unbound checkpoint", string(raw))
	}
	network, err := hex.DecodeString(output.NetworkID)
	if err != nil {
		t.Fatal(err)
	}
	policy, err := ynxauth.DecodeWalletPolicyProjection(output.Policy, network, source.owner)
	if err != nil {
		t.Fatal(err)
	}
	want := source.migration.AccountPolicy.Records[0]
	actual, ok := policy.PolicyAt(source.owner, uint64(f.actual.LastBlockHeight+1))
	if !ok || actual.Revision != want.Revision || !bytes.Equal(actual.PKA, want.PKA) || !bytes.Equal(actual.PKB, want.PKB) || !output.ExecutionPQSigningEnabled {
		t.Fatal("actual complete registered pair lost")
	}
	for _, kind := range []string{"caller-hash", "caller-height", "rpc", "wrong-owner", "wrong-pin", "duplicate-pin", "partial-schedule", "backup", "live-writer"} {
		t.Run(kind, func(t *testing.T) {
			bad := append([]string(nil), args...)
			switch kind {
			case "caller-hash":
				bad = append(bad, "--app-hash", output.CommittedAppHash)
			case "caller-height":
				bad = append(bad, "--height", output.CommittedHeight)
			case "rpc":
				bad = append(bad, "--rpc", "http://untrusted.invalid")
			case "wrong-owner":
				bad[len(bad)-1] = "0x" + strings.Repeat("a", 40)
			case "wrong-pin":
				for i := range bad {
					if bad[i] == "--consensus-genesis-sha256" {
						bad[i+1] = strings.Repeat("a", 64)
					}
				}
			case "duplicate-pin":
				bad = append(bad, "--original-genesis-hash", f.options.originalGenesisHash)
			case "partial-schedule":
				bad = append(bad, "--pq-engine-schedule-hash", strings.Repeat("1", 64))
			case "backup":
				bad = append(bad, "--backup-output", filepath.Join(t.TempDir(), "not-created"))
			case "live-writer":
				lease, err := consensus.AcquireApplicationStateWriterLease(f.options.state)
				if err != nil {
					t.Fatal(err)
				}
				defer lease.Close()
			}
			out, err := executeWalletPolicyInspection(bad)
			if err == nil || len(out) != 0 {
				t.Fatal("unsafe input produced policy JSON", kind, string(out), err)
			}
		})
	}
	after, err := os.ReadFile(f.options.state)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("readonly command modified original state", err)
	}
	assertBootstrapOriginalBytes(t, f.originals)
}

func TestInspectWalletPolicyNoRegistrationAndArgumentsFailClosed(t *testing.T) {
	f := newStoppedOperatorInspectionCommandFixture(t, false)
	args := append([]string(nil), f.args...)
	args[0] = "inspect-wallet-policy"
	args = append(args, "--owner", "0x"+strings.Repeat("a", 40))
	if out, err := executeWalletPolicyInspection(args); err == nil || len(out) != 0 {
		t.Fatal("unregistered ordinary account gained registered policy", string(out), err)
	}
	for _, args := range [][]string{{"inspect-wallet-policy"}, {"inspect-wallet-policy", "extra"}, {"inspect-wallet-policy", "--owner", "0x" + strings.Repeat("a", 40), "--owner", "0x" + strings.Repeat("a", 40)}} {
		if out, err := executeWalletPolicyInspection(args); err == nil || len(out) != 0 {
			t.Fatal("incomplete/duplicate input accepted", string(out), err)
		}
	}
}
