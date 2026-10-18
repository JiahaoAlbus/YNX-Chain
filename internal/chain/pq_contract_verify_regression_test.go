package chain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// This exercises the existing public source-verification method, not a fake
// authenticated callback. Setup uses real compiled contracts and the existing
// Devnet legacy-eligible deploy/write paths before migration. Those paths do
// not accept a classic signature envelope; they are not relabelled as signed
// transactions here. Migration and terminal revocation use real account keys
// and complete dual-PQ proofs. No ledger storage is assigned by the fixture.
func TestPQContractPublicVerifyPreservesExecutedState(t *testing.T) {
	for _, name := range []string{"SampleEVMWriteCounter", "SampleYNXTCompatibleERC20"} {
		for _, terminal := range []bool{false, true} {
			status := "active"
			if terminal {
				status = "terminal_revoked"
			}
			t.Run(name+"/"+status, func(t *testing.T) {
				f := newPQContractVerifyLedger(t)
				root, ok := repoRoot()
				if !ok {
					t.Fatal("fixed source repository is required")
				}
				sourceBytes, err := os.ReadFile(filepath.Join(root, consensusContractSources[name]))
				pqMust(t, err)
				source := strings.TrimSpace(string(sourceBytes))
				// Missing real compiler artifacts must fail, never skip this RED.
				material, err := readConsensusContractMaterial(root, name)
				pqMust(t, err)
				args := []string{"7"}
				calldata := "0x7cf5dab0" + fmt.Sprintf("%064x", 5)
				if name == "SampleYNXTCompatibleERC20" {
					args = []string{"1000000"}
					calldata = "0xa9059cbb" + strings.Repeat("0", 24) + strings.TrimPrefix(f.to, "0x") + fmt.Sprintf("%064x", 250)
				}
				policy, height := f.d.AccountAuthorization(f.owner)
				pqMust(t, policy.RequireLegacy(f.owner, height))
				deployed, deployTx, err := f.d.DeployContractWithArgs(f.owner, name, source, args)
				pqMust(t, err)
				if deployed.CompilerArtifact == nil || deployed.ArtifactKind != contractPinnedArtifactKind || deployTx.Hash == "" {
					t.Fatal("setup did not deploy an actual pinned compiled contract")
				}
				_, err = ValidateConsensusContractMaterial(deployed, material)
				pqMust(t, err)
				result, writeTx, err := f.d.ExecuteContract(f.owner, deployed.Address, calldata)
				pqMust(t, err)
				if writeTx.Hash == "" || result.OpcodeStepCount <= 0 || len(result.StorageWrites) == 0 || result.LogCount != 1 || result.ExecutionEngine != "local-bounded-evm-sstore-transition-interpreter" {
					t.Fatal("setup did not execute a real compiled SSTORE and event")
				}
				written, ok := f.d.Contract(deployed.Address)
				if !ok || reflect.DeepEqual(written.RuntimeStorage, deployed.RuntimeStorage) {
					t.Fatal("actual write must change constructor-seeded storage")
				}
				pqContractVerifyReadback(t, f.d, written, f.owner, f.to)

				account, _ := f.d.Account(f.owner)
				_, height = f.d.AccountAuthorization(f.owner)
				_, replayed, err := f.d.SubmitAccountMigration(f.migration(t, height+1, account.Nonce+1))
				pqMust(t, err)
				if replayed {
					t.Fatal("setup migration unexpectedly replayed")
				}
				f.d.ProduceBlock()
				policy, height = f.d.AccountAuthorization(f.owner)
				_, err = policy.TrustedRegistration(f.owner, ynxauth.TransactionPurpose, height)
				pqMust(t, err)
				if terminal {
					account, _ = f.d.Account(f.owner)
					_, replayed, err = f.d.SubmitAccountRevocation(pqRevocationWire(t, f, account.Nonce+1, height, 1))
					pqMust(t, err)
					if replayed {
						t.Fatal("setup revocation unexpectedly replayed")
					}
					f.d.ProduceBlock()
					policy, height = f.d.AccountAuthorization(f.owner)
					if _, err := policy.TrustedRegistration(f.owner, ynxauth.TransactionPurpose, height); err == nil {
						t.Fatal("setup did not reach effective terminal revocation")
					}
				}
				// The ordinary write authority really is closed in both states.
				unchanged := moduleBusinessState(t, f.d)
				if _, _, err := f.d.ExecuteContract(f.owner, deployed.Address, calldata); err == nil {
					t.Fatal("classic runtime write reopened after PQ activation")
				}
				assertModuleState(t, f.d, unchanged)
				if _, err := f.d.VerifyContract(deployed.Address, source+"\n// different source"); err == nil {
					t.Fatal("verification accepted a mismatched source hash")
				}
				assertModuleState(t, f.d, unchanged)

				want := pqContractVerifyExecutionState(t, f.d)
				for round := 1; round <= 2; round++ {
					verified, err := f.d.VerifyContract(deployed.Address, source)
					pqMust(t, err)
					if !verified.Verified || verified.VerifiedAt == nil || !verified.ReproducibleBuild || verified.DeployedBytecodeComparisonStatus != "matched_local_deployed_bytecode_hash" {
						t.Errorf("round %d: matching public source must still update verification metadata", round)
					}
					if !reflect.DeepEqual(verified.RuntimeStorage, written.RuntimeStorage) {
						t.Errorf("round %d: public verification reset executed runtime storage", round)
					}
					if !bytes.Equal(pqContractVerifyExecutionState(t, f.d), want) {
						t.Errorf("round %d: verification changed runtime/code/owner/constructor/assets or ledger history", round)
					}
					pqContractVerifyReadback(t, f.d, verified, f.owner, f.to)
				}
				persisted := moduleBusinessState(t, f.d)
				restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
				pqMust(t, err)
				assertModuleState(t, restored, persisted)
				if !bytes.Equal(pqContractVerifyExecutionState(t, restored), want) {
					t.Error("cold restart retained a verification-induced execution-state change")
				}
				pqContractVerifyReadback(t, restored, written, f.owner, f.to)
				_, err = restored.VerifyContract(deployed.Address, source)
				pqMust(t, err)
				if !bytes.Equal(pqContractVerifyExecutionState(t, restored), want) {
					t.Error("public verification after restart changed original execution state")
				}
			})
		}
	}
}

func newPQContractVerifyLedger(t *testing.T) *pqLedgerFixture {
	t.Helper()
	d, err := NewPersistentDevnet(DefaultNetworkConfig("devnet"), t.TempDir())
	pqMust(t, err)
	classic, err := secp256k1.GeneratePrivateKey()
	pqMust(t, err)
	t.Cleanup(classic.Zero)
	owner, err := nativeResourceAddress(classic.PubKey().SerializeCompressed())
	pqMust(t, err)
	key, public, err := ynxbatch.KeyGen()
	pqMust(t, err)
	t.Cleanup(key.Destroy)
	_, err = d.Faucet(owner, 1000)
	pqMust(t, err)
	pqMust(t, d.EnableAccountPQ(1))
	policy, _ := d.AccountAuthorization(owner)
	return &pqLedgerFixture{d: d, classic: classic, key: key, public: public, owner: owner, to: "0x3535353535353535353535353535353535353535", network: bytes.Clone(policy.NetworkID)}
}

// Compare the entire serialized business state, allowing only the six explicit
// verification metadata fields. JSON roundtrip detaches every map and slice;
// the comparison never scrubs or writes the real ledger. SavedAt is already
// normalized by moduleBusinessState. All runtime fields, compiler identities,
// balances, lots, policy history, blocks, pending txs and logs remain included.
func pqContractVerifyExecutionState(t *testing.T, d *Devnet) []byte {
	t.Helper()
	var snapshot devnetSnapshot
	pqMust(t, json.Unmarshal(moduleBusinessState(t, d), &snapshot))
	for address, artifact := range snapshot.Contracts {
		artifact.Verified = false
		artifact.VerifiedAt = nil
		artifact.VerifierStatus = ""
		artifact.ReproducibleBuild = false
		artifact.ReproducibilityStatus = ""
		artifact.DeployedBytecodeComparisonStatus = ""
		snapshot.Contracts[address] = artifact
	}
	raw, err := json.Marshal(snapshot)
	pqMust(t, err)
	return raw
}

func pqContractVerifyReadback(t *testing.T, d *Devnet, artifact ContractArtifact, owner, recipient string) {
	t.Helper()
	reads := []struct {
		calldata string
		value    int
	}{{"0x06661abd", 12}}
	if artifact.Name == "SampleYNXTCompatibleERC20" {
		reads = []struct {
			calldata string
			value    int
		}{
			{"0x18160ddd", 1000000},
			{"0x70a08231" + strings.Repeat("0", 24) + strings.TrimPrefix(evmAddressForLog(owner), "0x"), 999750},
			{"0x70a08231" + strings.Repeat("0", 24) + strings.TrimPrefix(recipient, "0x"), 250},
		}
	}
	for _, read := range reads {
		result, err := d.CallContract(artifact.Address, read.calldata)
		pqMust(t, err)
		if result.ExecutionEngine != "local-bounded-evm-opcode-interpreter" || result.OpcodeStepCount <= 0 || result.EncodedResult != fmt.Sprintf("0x%064x", read.value) {
			t.Errorf("compiled runtime read %s lost executed value %d: %+v", read.calldata, read.value, result)
		}
	}
}
