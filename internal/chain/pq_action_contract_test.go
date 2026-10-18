package chain

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func pqContractTestDeployPayload(t *testing.T, f *pqLedgerFixture, name string) ynxauth.ContractDeployPayload {
	t.Helper()
	root, ok := repoRoot()
	if !ok {
		t.Fatal("actual source root required")
	}
	source, err := os.ReadFile(filepath.Join(root, consensusContractSources[name]))
	pqMust(t, err)
	material, err := readConsensusContractMaterial(root, name)
	pqMust(t, err)
	actual := buildContractArtifactWithArgs("0x"+strings.Repeat("2", 40), f.owner, name, strings.TrimSpace(string(source)), false, nil, nil)
	_, err = ValidateConsensusContractMaterial(actual, material)
	pqMust(t, err)
	initial := uint64(7)
	if name == ynxauth.ContractERC20Name {
		initial = 1000000
	}
	return ynxauth.ContractDeployPayload{Name: name, SourceHash: actual.SourceHash, DeployedBytecodeHash: actual.DeployedBytecodeHash, CompilerConfigHash: actual.CompilerConfigHash, ConstructorArgs: []uint64{initial}}
}

func pqContractTestDeploy(t *testing.T, f *pqLedgerFixture, name string) (ContractArtifact, Transaction, []byte) {
	t.Helper()
	p := pqContractTestDeployPayload(t, f, name)
	a, _ := f.d.Account(f.owner)
	wire := f.actionMember(t, ynxauth.ActionContractDeploy, p, a.Nonce+1, ynxauth.ContractDeployFee, 2)
	tx, replayed, err := f.d.SubmitPQAction(wire)
	pqMust(t, err)
	if replayed || tx.Type != "contract_deploy" || tx.Hash != pqBatchHash(wire) || tx.Fee != 10 {
		t.Fatal("PQ deploy did not execute original action")
	}
	artifact, ok := f.d.Contract(tx.To)
	if !ok || artifact.CompilerArtifact == nil || artifact.ArtifactKind != contractPinnedArtifactKind || artifact.PQAnchorTransactionHash != tx.Hash {
		t.Fatal("actual compiled deployment missing")
	}
	return artifact, tx, wire
}

func pqContractTestCalldata(name, recipient string, n uint64) string {
	if name == ynxauth.ContractCounterName {
		return "0x7cf5dab0" + fmt.Sprintf("%064x", n)
	}
	return "0xa9059cbb" + strings.Repeat("0", 24) + strings.TrimPrefix(recipient, "0x") + fmt.Sprintf("%064x", n)
}

func pqContractTestWire(t *testing.T, f *pqLedgerFixture, a ContractArtifact, data string) []byte {
	t.Helper()
	commitment, err := ContractExecutionStateCommitment(a)
	pqMust(t, err)
	account, _ := f.d.Account(f.owner)
	p := ynxauth.ContractExecutePayload{Name: a.Name, Target: a.Address, SourceHash: a.SourceHash, DeployedBytecodeHash: a.DeployedBytecodeHash, CompilerConfigHash: a.CompilerConfigHash, ExpectedStorageCommitment: commitment, Calldata: data}
	return f.actionMember(t, ynxauth.ActionContractExecute, p, account.Nonce+1, ynxauth.ContractExecuteFee, 2)
}

func pqContractTestRead(t *testing.T, d *Devnet, a ContractArtifact, owner, other string, count, ownerBalance, otherBalance uint64) {
	t.Helper()
	cases := []struct {
		data string
		want uint64
	}{{"count", count}}
	if a.Name == ynxauth.ContractERC20Name {
		cases = []struct {
			data string
			want uint64
		}{{"0x70a08231" + strings.Repeat("0", 24) + owner[2:], ownerBalance}, {"0x70a08231" + strings.Repeat("0", 24) + other[2:], otherBalance}}
	}
	for _, c := range cases {
		result, err := d.CallContract(a.Address, c.data)
		pqMust(t, err)
		if result.EncodedResult != "0x"+fmt.Sprintf("%064x", c.want) || result.OpcodeStepCount <= 0 {
			t.Fatalf("actual bytecode readback differs: %+v", result)
		}
	}
}

func TestPQContractActionsCompiledLegacyInterleavingAndAllHistoryPaths(t *testing.T) {
	for _, name := range []string{ynxauth.ContractCounterName, ynxauth.ContractERC20Name} {
		t.Run(name, func(t *testing.T) {
			f := newPQContractVerifyLedger(t)
			f.activate(t)
			_, err := f.d.Faucet(f.to, 100)
			pqMust(t, err)
			start, _ := f.d.Account(f.owner)
			artifact, deploy, deployWire := pqContractTestDeploy(t, f, name)
			first := uint64(5)
			if name == ynxauth.ContractERC20Name {
				first = 250
			}
			wire := pqContractTestWire(t, f, artifact, pqContractTestCalldata(name, f.to, first))
			call, replay, err := f.d.SubmitPQAction(wire)
			pqMust(t, err)
			if replay || call.Type != "contract_call" || len(call.Logs) != 1 {
				t.Fatal("PQ execution did not retain raw pending VM log")
			}
			h, err := decodePQActionMemo(call.Memo)
			pqMust(t, err)
			if h.Contract.Transition == nil || len(h.Contract.Transition.StorageWrites) == 0 || h.Contract.Transition.StepCount <= 0 || len(h.Contract.ArtifactFile) != 0 {
				t.Fatal("real transition or single original anchor missing")
			}
			legacyBefore, _ := f.d.Account(f.to)
			legacyAmount := uint64(3)
			if name == ynxauth.ContractERC20Name {
				legacyAmount = 50
			}
			result, legacy, err := f.d.ExecuteContract(f.to, artifact.Address, pqContractTestCalldata(name, f.owner, legacyAmount))
			pqMust(t, err)
			if result.OpcodeStepCount <= 0 || result.LogCount != 1 {
				t.Fatal("legacy interleaving did not execute actual compiled bytecode")
			}
			legacyAfter, _ := f.d.Account(f.to)
			if !reflect.DeepEqual(legacyBefore, legacyAfter) || legacy.Fee != 2 || len(legacy.LotFlows) != 0 {
				t.Fatal("test silently changed legacy fee/nonce semantics")
			}
			if name == ynxauth.ContractCounterName && len(legacy.Logs) != 1 || name == ynxauth.ContractERC20Name && len(legacy.Logs) != 0 {
				t.Fatal("legacy pending log representation differs")
			}
			// Cold load while legacy is the latest call exercises both old pending
			// representations before any later signed action can anchor them again.
			cold, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
			pqMust(t, err)
			assertModuleState(t, cold, moduleBusinessState(t, f.d))
			artifact, _ = f.d.Contract(artifact.Address)
			last := uint64(2)
			if name == ynxauth.ContractERC20Name {
				last = 10
			}
			lastWire := pqContractTestWire(t, f, artifact, pqContractTestCalldata(name, f.to, last))
			lastTx, _, err := f.d.SubmitPQAction(lastWire)
			pqMust(t, err)
			end, _ := f.d.Account(f.owner)
			if end.Balance != start.Balance-14 || end.Nonce != start.Nonce+3 || end.ResourceUsage.BandwidthUsed != start.ResourceUsage.BandwidthUsed+3 || end.ResourceUsage.ComputeUsed != start.ResourceUsage.ComputeUsed+7 {
				t.Fatal("new PQ fees, nonces or resources were not actually applied")
			}
			for _, tx := range []Transaction{deploy, call, lastTx} {
				var total int64
				for _, flow := range tx.LotFlows {
					total += flow.Amount
				}
				if total != tx.Fee {
					t.Fatal("actual fee lot movement missing")
				}
			}
			pqContractTestRead(t, f.d, artifact, f.owner, f.to, 17, 999790, 210)
			f.d.ProduceBlock()
			cold, err = NewPersistentDevnet(f.d.cfg, f.d.dataDir)
			pqMust(t, err)
			assertModuleState(t, cold, moduleBusinessState(t, f.d))
			for _, batch := range []bool{false, true} {
				destination := NewDevnet(f.d.cfg)
				if batch {
					base := destination.LatestBlock()
					raw, err := f.d.ReplicationBatchJSON(base.Height, base.Hash)
					pqMust(t, err)
					_, err = destination.ApplyReplicationBatchJSON(raw)
					pqMust(t, err)
				} else {
					raw, err := f.d.ReplicationSnapshotJSON()
					pqMust(t, err)
					_, err = destination.ApplyReplicationSnapshotJSON(raw, false)
					pqMust(t, err)
				}
				got, ok := destination.Contract(artifact.Address)
				if !ok {
					t.Fatal("copy lost original contract")
				}
				want, _ := f.d.Contract(artifact.Address)
				if !reflect.DeepEqual(got, want) {
					t.Fatal("copy changed complete contract artifact")
				}
				pqContractTestRead(t, destination, got, f.owner, f.to, 17, 999790, 210)
			}
			migration, err := f.d.ExportConsensusMigrationState()
			pqMust(t, err)
			pqMust(t, migration.Validate())
			// Public verification remains metadata-only after genuine PQ writes.
			root, _ := repoRoot()
			source, err := os.ReadFile(filepath.Join(root, consensusContractSources[name]))
			pqMust(t, err)
			before, _ := f.d.Contract(artifact.Address)
			commitment, err := ContractExecutionStateCommitment(before)
			pqMust(t, err)
			_, err = f.d.VerifyContract(artifact.Address, strings.TrimSpace(string(source)))
			pqMust(t, err)
			after, _ := f.d.Contract(artifact.Address)
			verifiedCommitment, err := ContractExecutionStateCommitment(after)
			pqMust(t, err)
			if verifiedCommitment != commitment {
				t.Fatal("public metadata changed signed execution prestate")
			}
			if old, done, err := cold.SubmitPQAction(deployWire); err != nil || !done || old.Hash != deploy.Hash {
				t.Fatal("cold raw deployment replay failed")
			}
		})
	}
}

func TestPQContractLegacyFirstAnchorPreservesExistingExecutedState(t *testing.T) {
	for _, name := range []string{ynxauth.ContractCounterName, ynxauth.ContractERC20Name} {
		t.Run(name, func(t *testing.T) {
			f := newPQContractVerifyLedger(t)
			root, _ := repoRoot()
			source, err := os.ReadFile(filepath.Join(root, consensusContractSources[name]))
			pqMust(t, err)
			arg := "7"
			amount := uint64(5)
			if name == ynxauth.ContractERC20Name {
				arg = "1000000"
				amount = 250
			}
			artifact, _, err := f.d.DeployContractWithArgs(f.owner, name, strings.TrimSpace(string(source)), []string{arg})
			pqMust(t, err)
			_, _, err = f.d.ExecuteContract(f.owner, artifact.Address, pqContractTestCalldata(name, f.to, amount))
			pqMust(t, err)
			// Old no-anchor snapshots remain loadable. A real migration uses the
			// consumed legacy deploy nonce rather than assuming legacy calls used one.
			cold, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
			pqMust(t, err)
			assertModuleState(t, cold, moduleBusinessState(t, f.d))
			account, _ := f.d.Account(f.owner)
			_, height := f.d.AccountAuthorization(f.owner)
			_, _, err = f.d.SubmitAccountMigration(f.migration(t, height+1, account.Nonce+1))
			pqMust(t, err)
			f.d.ProduceBlock()
			artifact, _ = f.d.Contract(artifact.Address)
			wire := pqContractTestWire(t, f, artifact, pqContractTestCalldata(name, f.to, 1))
			tx, _, err := f.d.SubmitPQAction(wire)
			pqMust(t, err)
			h, err := decodePQActionMemo(tx.Memo)
			pqMust(t, err)
			if h.Contract.Source == "" || len(h.Contract.ArtifactFile) == 0 || h.Contract.Artifact.PQAnchorTransactionHash != "" || !reflect.DeepEqual(h.Contract.Artifact.RuntimeStorage, artifact.RuntimeStorage) {
				t.Fatal("first signature did not anchor actual executed legacy state")
			}
			anchored, _ := f.d.Contract(artifact.Address)
			if anchored.PQAnchorTransactionHash != tx.Hash {
				t.Fatal("first signed legacy prestate did not initialize its terminal anchor")
			}
			cold, err = NewPersistentDevnet(f.d.cfg, f.d.dataDir)
			pqMust(t, err)
			assertModuleState(t, cold, moduleBusinessState(t, f.d))
		})
	}
}

func TestPQContractHistoryRejectsRechecksummedPrePostIdentityAndLegacyTampering(t *testing.T) {
	f := newPQContractVerifyLedger(t)
	f.activate(t)
	a, _, _ := pqContractTestDeploy(t, f, ynxauth.ContractCounterName)
	wire := pqContractTestWire(t, f, a, pqContractTestCalldata(a.Name, f.to, 5))
	call, _, err := f.d.SubmitPQAction(wire)
	pqMust(t, err)
	_, legacy, err := f.d.ExecuteContract(f.to, a.Address, pqContractTestCalldata(a.Name, f.to, 3))
	pqMust(t, err)
	f.d.ProduceBlock()
	mutations := []struct {
		name string
		edit func(*devnetSnapshot)
	}{
		{"snapshot-storage", func(s *devnetSnapshot) {
			c := s.Contracts[a.Address]
			c.RuntimeStorage["0x"+strings.Repeat("0", 64)] = "0x" + fmt.Sprintf("%064x", 99)
		}},
		{"snapshot-owner", func(s *devnetSnapshot) { c := s.Contracts[a.Address]; c.Deployer = f.to; s.Contracts[a.Address] = c }},
		{"snapshot-missing-marker", func(s *devnetSnapshot) {
			c := s.Contracts[a.Address]
			c.PQAnchorTransactionHash = ""
			s.Contracts[a.Address] = c
		}},
		{"snapshot-replaced-marker", func(s *devnetSnapshot) {
			c := s.Contracts[a.Address]
			c.PQAnchorTransactionHash = call.Hash
			s.Contracts[a.Address] = c
		}},
		{"snapshot-constructor", func(s *devnetSnapshot) {
			c := s.Contracts[a.Address]
			c.ConstructorArgs = []string{"8"}
			s.Contracts[a.Address] = c
		}},
		{"receipt-before", func(s *devnetSnapshot) {
			tx := pqHistoryMetadataTransaction(t, s.Blocks, call.Hash)
			h, e := decodePQActionMemo(tx.Memo)
			pqMust(t, e)
			h.Contract.Artifact.RuntimeStorage["0x"+strings.Repeat("0", 64)] = "0x" + fmt.Sprintf("%064x", 8)
			raw, e := json.Marshal(h.Contract)
			pqMust(t, e)
			framed, e := ynxbatchFrameForContractTest(h.Wire, raw)
			pqMust(t, e)
			tx.Memo = pqActionMemo + fmt.Sprintf("%x", framed)
		}},
		{"receipt-after", func(s *devnetSnapshot) {
			tx := pqHistoryMetadataTransaction(t, s.Blocks, call.Hash)
			h, e := decodePQActionMemo(tx.Memo)
			pqMust(t, e)
			h.Contract.Transition.Storage["0x"+strings.Repeat("0", 64)] = "0x" + fmt.Sprintf("%064x", 99)
			tx.Memo, e = encodePQContractActionMemo(h.Wire, *h.Contract)
			pqMust(t, e)
		}},
		{"receipt-result", func(s *devnetSnapshot) {
			tx := pqHistoryMetadataTransaction(t, s.Blocks, call.Hash)
			h, e := decodePQActionMemo(tx.Memo)
			pqMust(t, e)
			h.Contract.Transition.EncodedResult = "0x" + fmt.Sprintf("%064x", 99)
			tx.Memo, e = encodePQContractActionMemo(h.Wire, *h.Contract)
			pqMust(t, e)
		}},
		{"legacy-missing-log", func(s *devnetSnapshot) {
			tx := pqHistoryMetadataTransaction(t, s.Blocks, legacy.Hash)
			tx.Logs = tx.Logs[:1]
		}},
		{"legacy-postcount", func(s *devnetSnapshot) {
			tx := pqHistoryMetadataTransaction(t, s.Blocks, legacy.Hash)
			tx.Logs[1].Data = "0x" + fmt.Sprintf("%064x", 99)
		}},
		{"legacy-wrong-caller", func(s *devnetSnapshot) {
			tx := pqHistoryMetadataTransaction(t, s.Blocks, legacy.Hash)
			tx.Logs[1].Topics[1] = evmTopic(f.owner)
		}},
		{"pq-forged-position", func(s *devnetSnapshot) {
			tx := pqHistoryMetadataTransaction(t, s.Blocks, call.Hash)
			tx.Logs[1].LogIndex++
		}},
		{"pq-unsigned-resource", func(s *devnetSnapshot) {
			pqHistoryMetadataForgeSponsor(pqHistoryMetadataTransaction(t, s.Blocks, call.Hash))
		}},
		{"pq-negative-fee-flow", func(s *devnetSnapshot) { pqHistoryMetadataTransaction(t, s.Blocks, call.Hash).LotFlows[0].Amount = -2 }},
		{"legacy-forged-block", func(s *devnetSnapshot) {
			pqHistoryMetadataTransaction(t, s.Blocks, legacy.Hash).BlockHash = strings.Repeat("a", 64)
		}},
	}
	for _, m := range mutations {
		t.Run(m.name, func(t *testing.T) {
			s := pqBatchSnapshotCopy(t, f.d)
			m.edit(&s)
			payload := pqHistoryMetadataPayload(t, s)
			destination := NewDevnet(f.d.cfg)
			before := moduleBusinessState(t, destination)
			if _, err := destination.ApplyReplicationSnapshotJSON(payload, false); err == nil {
				t.Fatal("rechecksummed execution tamper accepted")
			}
			assertModuleState(t, destination, before)
		})
	}
}

func TestPQContractDurabilityRollbackUnknownAndOriginalBytes(t *testing.T) {
	for _, kind := range []string{ynxauth.ActionContractDeploy, ynxauth.ActionContractExecute} {
		for _, afterRename := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/afterRename=%t", kind, afterRename), func(t *testing.T) {
				f := newPQContractVerifyLedger(t)
				f.activate(t)
				var wire []byte
				if kind == ynxauth.ActionContractDeploy {
					account, _ := f.d.Account(f.owner)
					wire = f.actionMember(t, kind, pqContractTestDeployPayload(t, f, ynxauth.ContractCounterName), account.Nonce+1, 10, 1)
				} else {
					a, _, _ := pqContractTestDeploy(t, f, ynxauth.ContractCounterName)
					wire = pqContractTestWire(t, f, a, pqContractTestCalldata(a.Name, f.to, 5))
				}
				before := moduleBusinessState(t, f.d)
				accountBefore, _ := f.d.Account(f.owner)
				path := f.d.snapshotPath() + ".tmp"
				if afterRename {
					path = f.d.snapshotIntegrityMarkerPath() + ".tmp"
				}
				unblock := blockSnapshotWrite(t, path)
				tx, replay, err := f.d.SubmitPQAction(wire)
				if err == nil || replay {
					t.Fatal("checkpoint failure acknowledged contract")
				}
				if afterRename {
					if !errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash == "" {
						t.Fatal("UNKNOWN lost original contract result")
					}
					retained := moduleBusinessState(t, f.d)
					if again, done, e := f.d.SubmitPQAction(wire); !errors.Is(e, ErrSnapshotDurabilityUncertain) || done || again.Hash != tx.Hash {
						t.Fatal("UNKNOWN retry changed original execution")
					}
					assertModuleState(t, f.d, retained)
					assertModuleState(t, readTransferSnapshot(t, f.d), retained)
				} else {
					if errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash != "" {
						t.Fatal("definite failure kept contract mutation")
					}
					assertModuleState(t, f.d, before)
				}
				unblock()
				accepted, done, err := f.d.SubmitPQAction(wire)
				pqMust(t, err)
				if done != afterRename || accepted.Hash != pqBatchHash(wire) {
					t.Fatal("reconciliation changed exact original wire outcome")
				}
				after, _ := f.d.Account(f.owner)
				if after.Nonce != accountBefore.Nonce+1 || after.Balance != accountBefore.Balance-accepted.Fee {
					t.Fatal("retry executed fee/nonce more than once")
				}
				cold, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
				pqMust(t, err)
				assertModuleState(t, cold, moduleBusinessState(t, f.d))
				if got, done, err := cold.SubmitPQAction(wire); err != nil || !done || got.Hash != accepted.Hash {
					t.Fatal("cold raw wire replay failed")
				}
			})
		}
	}
}

func TestPQContractFeeAliasOverflowAndStalePrestate(t *testing.T) {
	f := newPQContractVerifyLedger(t)
	f.activate(t)
	a, _, _ := pqContractTestDeploy(t, f, ynxauth.ContractCounterName)
	wire := pqContractTestWire(t, f, a, pqContractTestCalldata(a.Name, f.to, 5))
	// Test-only boundary setup changes no authority: each attempted action still
	// requires its real current dual signature and exact nonce.
	feeAddress := f.d.nextValidatorAddressLocked()
	recipient := f.d.account(feeAddress)
	oldBalance := recipient.Balance
	recipient.Balance = math.MaxInt64
	before := moduleBusinessState(t, f.d)
	if _, _, err := f.d.SubmitPQAction(wire); err == nil {
		t.Fatal("fee recipient overflow accepted")
	}
	assertModuleState(t, f.d, before)
	recipient.Balance = oldBalance
	for _, field := range []string{"bandwidth", "compute"} {
		sender := f.d.accounts[f.owner]
		saved := sender.ResourceUsage
		if field == "bandwidth" {
			sender.ResourceUsage.BandwidthUsed = math.MaxInt64
		} else {
			sender.ResourceUsage.ComputeUsed = math.MaxInt64
		}
		before = moduleBusinessState(t, f.d)
		if _, _, err := f.d.SubmitPQAction(wire); err == nil {
			t.Fatal("resource overflow accepted")
		}
		assertModuleState(t, f.d, before)
		sender.ResourceUsage = saved
	}
	_, _, err := f.d.ExecuteContract(f.to, a.Address, pqContractTestCalldata(a.Name, f.to, 1))
	pqMust(t, err)
	before = moduleBusinessState(t, f.d)
	if _, _, err := f.d.SubmitPQAction(wire); err == nil {
		t.Fatal("stale complete prestate accepted")
	}
	assertModuleState(t, f.d, before)
	a, _ = f.d.Contract(a.Address)
	wire = pqContractTestWire(t, f, a, pqContractTestCalldata(a.Name, f.to, 5))
	for i := range f.d.validators {
		f.d.validators[i].Address = f.owner
	}
	beforeAccount, _ := f.d.Account(f.owner)
	tx, _, err := f.d.SubmitPQAction(wire)
	pqMust(t, err)
	afterAccount, _ := f.d.Account(f.owner)
	if afterAccount.Balance != beforeAccount.Balance || !reflect.DeepEqual(afterAccount.Lots, beforeAccount.Lots) || afterAccount.Nonce != beforeAccount.Nonce+1 || len(tx.LotFlows) == 0 || tx.LotFlows[0].To != f.owner {
		t.Fatal("self fee alias changed net assets or skipped nonce")
	}
}

func TestPQContractCommitmentCompleteIdentityAndPublicMetadata(t *testing.T) {
	a := ContractArtifact{Address: "0x" + strings.Repeat("1", 40), Deployer: "0x" + strings.Repeat("2", 40), Name: "vector", DeployedAt: time.Unix(123, 0).UTC(), ConstructorArgs: []string{"7"}, RuntimeStorage: map[string]string{"0x" + strings.Repeat("0", 64): "0x" + fmt.Sprintf("%064x", 7)}}
	want, err := ContractExecutionStateCommitment(a)
	pqMust(t, err)
	// Independent JS encoder: 815-byte immutable projection, 1052-byte E frame,
	// standard SHA-256 checked against its published "abc" known-answer digest.
	if want != "880a1cb968cbf3a7e881ca71f6ebce22cc44239b2c7c28f50423aff34dbca2a1" {
		t.Fatal("execution-state commitment differs from independent framing vector")
	}
	when := time.Unix(456, 0).UTC()
	a.Verified = true
	a.VerifiedAt = &when
	a.VerifierStatus = "verified"
	a.ReproducibleBuild = true
	a.ReproducibilityStatus = "matched"
	a.DeployedBytecodeComparisonStatus = "matched"
	got, err := ContractExecutionStateCommitment(a)
	pqMust(t, err)
	if got != want {
		t.Fatal("six public verification metadata fields entered execution commitment")
	}
	for _, edit := range []func(*ContractArtifact){func(a *ContractArtifact) { a.Deployer = "0x" + strings.Repeat("3", 40) }, func(a *ContractArtifact) { a.ConstructorArgs = []string{"8"} }, func(a *ContractArtifact) { a.DeployedAt = a.DeployedAt.Add(time.Second) }, func(a *ContractArtifact) { a.CompilerConfigHash = strings.Repeat("a", 64) }, func(a *ContractArtifact) { a.PQAnchorTransactionHash = "0x" + strings.Repeat("b", 64) }} {
		copy := a
		edit(&copy)
		got, err := ContractExecutionStateCommitment(copy)
		pqMust(t, err)
		if got == want {
			t.Fatal("execution identity escaped commitment")
		}
	}
	a.RuntimeStorage["0x0"] = "0x1"
	if _, err := ContractExecutionStateCommitment(a); err == nil {
		t.Fatal("storage alias silently normalized")
	}
}

func ynxbatchFrameForContractTest(fields ...[]byte) ([]byte, error) {
	return ynxbatch.EncodeFields(fields...)
}

func TestPQContractKnownAnchorReplicationContinuation(t *testing.T) {
	f := newPQContractVerifyLedger(t)
	f.activate(t)
	deployed, _, _ := pqContractTestDeploy(t, f, ynxauth.ContractCounterName)
	wire := pqContractTestWire(t, f, deployed, pqContractTestCalldata(deployed.Name, f.to, 5))
	call, _, err := f.d.SubmitPQAction(wire)
	pqMust(t, err)
	pending, err := f.d.ReplicationSnapshotJSON()
	pqMust(t, err)
	newFollower := func(t *testing.T) *Devnet {
		t.Helper()
		d := NewDevnet(f.d.cfg)
		_, err := d.ApplyReplicationSnapshotJSON(pending, false)
		pqMust(t, err)
		return d
	}
	mutations := []struct {
		name           string
		edit           func(*devnetSnapshot)
		selfConsistent bool
	}{
		{"erase-marker-and-all-receipts", func(s *devnetSnapshot) {
			c := s.Contracts[deployed.Address]
			c.PQAnchorTransactionHash = ""
			s.Contracts[deployed.Address] = c
			kept := s.Pending[:0]
			for _, tx := range s.Pending {
				if tx.To != deployed.Address {
					kept = append(kept, tx)
				}
			}
			s.Pending = kept
		}, true},
		{"erase-later-receipt-and-restore-prior-state", func(s *devnetSnapshot) {
			s.Contracts[deployed.Address] = deployed
			kept := s.Pending[:0]
			for _, tx := range s.Pending {
				if tx.Hash != call.Hash {
					kept = append(kept, tx)
				}
			}
			s.Pending = kept
		}, true},
		{"orphan-marker", func(s *devnetSnapshot) {
			kept := s.Pending[:0]
			for _, tx := range s.Pending {
				if tx.To != deployed.Address {
					kept = append(kept, tx)
				}
			}
			s.Pending = kept
		}, false},
	}
	for _, mutation := range mutations {
		for _, batchMode := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/batch=%t", mutation.name, batchMode), func(t *testing.T) {
				destination := newFollower(t)
				before := moduleBusinessState(t, destination)
				bad := pqBatchSnapshotCopy(t, f.d)
				mutation.edit(&bad)
				if mutation.selfConsistent {
					// These two candidates are internally consistent under the
					// legacy/remaining anchor boundary. The trusted local history,
					// not a self-authenticating marker, must reject their rollback.
					pqMust(t, validateAccountPolicySnapshot(bad))
				}
				var err error
				if !batchMode {
					_, err = destination.ApplyReplicationSnapshotJSON(pqHistoryMetadataPayload(t, bad), false)
				} else {
					base := destination.LatestBlock()
					raw, e := f.d.ReplicationBatchJSON(base.Height, base.Hash)
					pqMust(t, e)
					var batch replicationBatch
					pqMust(t, json.Unmarshal(raw, &batch))
					if !batch.Complete || batch.State == nil {
						t.Fatal("expected complete authoritative batch")
					}
					bad.Blocks = nil
					bad.StateIntegrity, e = replicationStateIntegrity(bad)
					pqMust(t, e)
					batch.State = &bad
					batch.Integrity, e = replicationBatchIntegrity(batch)
					pqMust(t, e)
					raw, e = json.Marshal(batch)
					pqMust(t, e)
					_, err = destination.ApplyReplicationBatchJSON(raw)
				}
				if err == nil {
					t.Fatal("known contract anchor or history was downgraded by replication")
				}
				if mutation.selfConsistent && !strings.Contains(err.Error(), "known contract") {
					t.Fatalf("candidate did not reach the local continuity guard: %v", err)
				}
				assertModuleState(t, destination, before)
			})
		}
	}
	// A pending receipt must survive ordinary mining, whose block identity and
	// logs change deterministically, through both actual replication entrypoints.
	f.d.ProduceBlock()
	for _, batchMode := range []bool{false, true} {
		t.Run(fmt.Sprintf("pending-to-mined/batch=%t", batchMode), func(t *testing.T) {
			destination := newFollower(t)
			if batchMode {
				base := destination.LatestBlock()
				raw, e := f.d.ReplicationBatchJSON(base.Height, base.Hash)
				pqMust(t, e)
				_, e = destination.ApplyReplicationBatchJSON(raw)
				pqMust(t, e)
			} else {
				raw, e := f.d.ReplicationSnapshotJSON()
				pqMust(t, e)
				_, e = destination.ApplyReplicationSnapshotJSON(raw, false)
				pqMust(t, e)
			}
			got, found := destination.Transaction(call.Hash)
			if !found || got.BlockNum == 0 || got.Memo != call.Memo {
				t.Fatal("pending-to-mined import lost original receipt")
			}
			artifact, _ := destination.Contract(deployed.Address)
			if artifact.PQAnchorTransactionHash != deployed.PQAnchorTransactionHash {
				t.Fatal("mining replaced original anchor")
			}
			pqContractTestRead(t, destination, artifact, f.owner, f.to, 12, 0, 0)
		})
	}
}

func TestPQContractTamperRejectedAtColdBatchAndSourceRuntimeBoundaries(t *testing.T) {
	f := newPQContractVerifyLedger(t)
	f.activate(t)
	a, _, _ := pqContractTestDeploy(t, f, ynxauth.ContractCounterName)
	wire := pqContractTestWire(t, f, a, pqContractTestCalldata(a.Name, f.to, 5))
	_, _, err := f.d.SubmitPQAction(wire)
	pqMust(t, err)
	f.d.ProduceBlock()
	forge := func(contracts map[string]ContractArtifact) {
		c := contracts[a.Address]
		c.RuntimeStorage["0x"+strings.Repeat("0", 64)] = "0x" + fmt.Sprintf("%064x", 99)
	}
	t.Run("cold", func(t *testing.T) {
		bad := pqBatchSnapshotCopy(t, f.d)
		forge(bad.Contracts)
		destination := NewDevnet(f.d.cfg)
		destination.dataDir = t.TempDir()
		before := moduleBusinessState(t, destination)
		pqMust(t, os.WriteFile(destination.snapshotPath(), pqHistoryMetadataPayload(t, bad), 0o600))
		if err := destination.loadSnapshot(); err == nil {
			t.Fatal("cold load accepted rechecksummed storage tamper")
		}
		assertModuleState(t, destination, before)
	})
	t.Run("final-batch", func(t *testing.T) {
		destination := NewDevnet(f.d.cfg)
		before := moduleBusinessState(t, destination)
		base := destination.LatestBlock()
		raw, err := f.d.ReplicationBatchJSON(base.Height, base.Hash)
		pqMust(t, err)
		var batch replicationBatch
		pqMust(t, json.Unmarshal(raw, &batch))
		if !batch.Complete || batch.State == nil {
			t.Fatal("expected authoritative final batch")
		}
		forge(batch.State.Contracts)
		batch.State.StateIntegrity, err = replicationStateIntegrity(*batch.State)
		pqMust(t, err)
		batch.Integrity, err = replicationBatchIntegrity(batch)
		pqMust(t, err)
		raw, err = json.Marshal(batch)
		pqMust(t, err)
		if _, err := destination.ApplyReplicationBatchJSON(raw); err == nil {
			t.Fatal("final batch accepted rechecksummed storage tamper")
		}
		assertModuleState(t, destination, before)
	})
	t.Run("consensus-source-runtime", func(t *testing.T) {
		migration, err := f.d.ExportConsensusMigrationState()
		pqMust(t, err)
		pqMust(t, migration.Validate())
		forge(migration.Runtime.Contracts)
		migration.StateHash, err = migration.calculateHash()
		pqMust(t, err)
		if err := migration.Validate(); err == nil {
			t.Fatal("consensus source accepted altered actual runtime state")
		}
		if _, err := migration.RestoreSourceRuntime(); err == nil {
			t.Fatal("source runtime restore accepted altered actual runtime state")
		}
	})
}

func TestPQContractTerminalRevocationPreservesHistoricalCalls(t *testing.T) {
	f := newPQContractVerifyLedger(t)
	f.activate(t)
	a, _, _ := pqContractTestDeploy(t, f, ynxauth.ContractCounterName)
	wire := pqContractTestWire(t, f, a, pqContractTestCalldata(a.Name, f.to, 5))
	call, _, err := f.d.SubmitPQAction(wire)
	pqMust(t, err)
	account, _ := f.d.Account(f.owner)
	_, height := f.d.AccountAuthorization(f.owner)
	_, _, err = f.d.SubmitAccountRevocation(pqRevocationWire(t, f, account.Nonce+1, height, 1))
	pqMust(t, err)
	f.d.ProduceBlock()
	a, _ = f.d.Contract(a.Address)
	newWire := pqContractTestWire(t, f, a, pqContractTestCalldata(a.Name, f.to, 1))
	before := moduleBusinessState(t, f.d)
	if _, _, err := f.d.SubmitPQAction(newWire); err == nil {
		t.Fatal("terminal revoked owner executed a new PQ contract action")
	}
	if _, _, err := f.d.ExecuteContract(f.owner, a.Address, pqContractTestCalldata(a.Name, f.to, 1)); err == nil {
		t.Fatal("terminal revoked owner regained classic execution")
	}
	assertModuleState(t, f.d, before)
	// The contract is publicly callable by a different eligible caller. Owner
	// account revocation must not freeze that caller or erase earlier signatures.
	_, _, err = f.d.ExecuteContract(f.to, a.Address, pqContractTestCalldata(a.Name, f.to, 1))
	pqMust(t, err)
	cold, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	pqMust(t, err)
	assertModuleState(t, cold, moduleBusinessState(t, f.d))
	if old, replayed, err := cold.SubmitPQAction(wire); err != nil || !replayed || old.Hash != call.Hash {
		t.Fatal("terminal revocation erased original historical action")
	}
	cold.ProduceBlock()
	migration, err := cold.ExportConsensusMigrationState()
	pqMust(t, err)
	pqMust(t, migration.Validate())
}

func TestPQContractActualCodeAndRevertRejectBeforeMutation(t *testing.T) {
	for _, name := range []string{ynxauth.ContractCounterName, ynxauth.ContractERC20Name} {
		t.Run(name, func(t *testing.T) {
			f := newPQContractVerifyLedger(t)
			f.activate(t)
			p := pqContractTestDeployPayload(t, f, name)
			p.DeployedBytecodeHash = strings.Repeat("a", 64)
			account, _ := f.d.Account(f.owner)
			badDeploy := f.actionMember(t, ynxauth.ActionContractDeploy, p, account.Nonce+1, 10, 2)
			before := moduleBusinessState(t, f.d)
			if _, _, err := f.d.SubmitPQAction(badDeploy); err == nil {
				t.Fatal("genuine signature on false deployed code hash was accepted")
			}
			assertModuleState(t, f.d, before)
			a, _, _ := pqContractTestDeploy(t, f, name)
			data := "0x7cf5dab0" + strings.Repeat("f", 64) // 7 + max uint256 reverts.
			if name == ynxauth.ContractERC20Name {
				data = pqContractTestCalldata(name, f.to, 1000001)
			}
			wire := pqContractTestWire(t, f, a, data)
			before = moduleBusinessState(t, f.d)
			if _, _, err := f.d.SubmitPQAction(wire); err == nil {
				t.Fatal("actual compiled revert was admitted as a successful contract write")
			}
			assertModuleState(t, f.d, before)
			// Both genuine signature branches are required even for otherwise
			// legal business data; corruption cannot consume nonce or fee.
			wire = pqContractTestWire(t, f, a, pqContractTestCalldata(name, f.to, 1))
			wire[len(wire)-1] ^= 1
			if _, _, err := f.d.SubmitPQAction(wire); err == nil {
				t.Fatal("corrupted original dual-signature action accepted")
			}
			assertModuleState(t, f.d, before)
		})
	}
}
